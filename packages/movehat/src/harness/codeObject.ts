import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { MovehatRuntime } from "../types/runtime.js";
import type {
  DeployCodeObjectOptions,
  UpgradeCodeObjectOptions,
  CodeObjectInfo,
} from "../types/harness.js";
import { extractNamedAddresses } from "../commands/compile.js";
import {
  saveDeployment,
  loadDeployment,
  validateSafeName,
  type DeploymentInfo,
} from "../core/deployments.js";
import { validatePathSafety, validateProfileSafety } from "../core/shell.js";
import {
  CliExecutionError,
  ModuleAlreadyDeployedError,
  PostPublishError,
} from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { logger } from "../ui/index.js";
import {
  withYamlLock,
  addProfile,
  removeProfile,
  removeProfileSync,
  ensureSignalHandler,
  cleanupCallbacks,
} from "../core/movementProfile.js";

/**
 * Deploy a Move package as a code object via `movement move deploy-object`.
 *
 * Mirrors `core/Publisher.deploy` exactly for the security-critical parts
 * (per-deploy unique profile, atomic ~/.aptos/config.yaml mutation under
 * the shared mutex, SIGINT-safe sync cleanup, stderr redaction via
 * `runCli`). The only differences are:
 *
 *   1. CLI subcommand: `deploy-object` instead of `publish` + a required
 *      `--address-name <moduleName>` flag that binds the derived object
 *      address to the package's named-address slot.
 *   2. `DeploymentInfo.address` is the derived **object address** parsed
 *      from CLI output, not the deployer's account address.
 *
 * @internal — called from `Harness.deployCodeObject`.
 */
export async function deployCodeObject(
  runtime: MovehatRuntime,
  options: DeployCodeObjectOptions
): Promise<CodeObjectInfo> {
  return executeMovementMoveObject({
    runtime,
    moduleName: options.moduleName,
    packageDir: options.packageDir,
    namedAddresses: options.namedAddresses,
    includedArtifacts: options.includedArtifacts,
    adapter: options.adapter,
    subcommand: "deploy-object",
    extraArgs: [],
    checkIdempotency: true,
  });
}

/**
 * Upgrade an existing code object via `movement move upgrade-object`.
 *
 * Requires {@link UpgradeCodeObjectOptions.objectAddress} — the address
 * of the existing on-chain object. The local `DeploymentInfo` record
 * for `moduleName` is overwritten with a new timestamp + txHash; the
 * address stays the same.
 *
 * @internal — called from `Harness.upgradeCodeObject`.
 */
export async function upgradeCodeObject(
  runtime: MovehatRuntime,
  options: UpgradeCodeObjectOptions
): Promise<CodeObjectInfo> {
  if (!options.objectAddress) {
    throw new Error(
      "Harness.upgradeCodeObject requires options.objectAddress (the existing object's address)."
    );
  }
  return executeMovementMoveObject({
    runtime,
    moduleName: options.moduleName,
    packageDir: options.packageDir,
    namedAddresses: options.namedAddresses,
    includedArtifacts: options.includedArtifacts,
    adapter: options.adapter,
    subcommand: "upgrade-object",
    extraArgs: ["--object-address", options.objectAddress],
    checkIdempotency: false,
    fixedAddress: options.objectAddress,
  });
}

interface ExecuteOptions {
  runtime: MovehatRuntime;
  moduleName: string;
  packageDir?: string | undefined;
  namedAddresses?: Record<string, string> | undefined;
  includedArtifacts?: "none" | "sparse" | "all" | undefined;
  adapter?: import("../utils/childProcessAdapter.js").ChildProcessAdapter | undefined;
  subcommand: "deploy-object" | "upgrade-object";
  extraArgs: readonly string[];
  /** Whether to throw `ModuleAlreadyDeployedError` if a record exists. */
  checkIdempotency: boolean;
  /**
   * For upgrade-object: the object's existing address. Skips the parse-
   * from-stdout step (the address is known up front).
   */
  fixedAddress?: string;
}

async function executeMovementMoveObject(
  opts: ExecuteOptions
): Promise<CodeObjectInfo> {
  const { runtime, moduleName, subcommand } = opts;
  const config = runtime.config;
  const account = runtime.account;

  validateSafeName(moduleName, "module");

  // Idempotency: deploy-object refuses re-deploy unless MH_CLI_REDEPLOY=true.
  // Upgrade does not check this (the whole point is to overwrite).
  const forceRedeploy = process.env.MH_CLI_REDEPLOY === "true";
  if (opts.checkIdempotency) {
    const existing = loadDeployment(config.network, moduleName);
    if (existing && !forceRedeploy) {
      const errorDetails = [
        `Module "${moduleName}" is already deployed on ${config.network}`,
        `Address: ${existing.address}`,
        `Deployed at: ${new Date(existing.timestamp).toLocaleString()}`,
        existing.txHash ? `Transaction: ${existing.txHash}` : null,
        `\nTo redeploy, set MH_CLI_REDEPLOY=true or call harness.upgradeCodeObject({ objectAddress: "${existing.address}", ... }).`,
      ]
        .filter(Boolean)
        .join("\n");

      logger.error(
        `Module "${moduleName}" is already deployed on ${config.network}`
      );
      logger.plain(`   Address: ${existing.address}`);
      logger.plain(
        `   Deployed at: ${new Date(existing.timestamp).toLocaleString()}`
      );
      if (existing.txHash) logger.plain(`   Transaction: ${existing.txHash}`);
      logger.newline();

      throw new ModuleAlreadyDeployedError(
        errorDetails,
        moduleName,
        config.network,
        existing.address,
        existing.timestamp,
        existing.txHash
      );
    }
  }

  const dir = opts.packageDir || config.moveDir;
  const profile = `movehat-deploy-${randomUUID().slice(0, 8)}`;
  const safeDir = validatePathSafety(dir, "package directory");
  const safeProfile = validateProfileSafety(profile);

  logger.step(
    `${subcommand === "deploy-object" ? "Deploying" : "Upgrading"} module "${moduleName}" from ${dir}...`
  );

  try {
    const deployerAddress = account.accountAddress.toString();

    // Build named-addresses arg: auto-detected names from Move sources
    // are bound to the deployer's address (Publisher convention).
    // Caller-supplied `namedAddresses` overlay on top.
    const detectedAddresses = extractNamedAddresses(dir);
    const addrMap = new Map<string, string>();
    for (const name of detectedAddresses) addrMap.set(name, deployerAddress);
    if (opts.namedAddresses) {
      for (const [k, v] of Object.entries(opts.namedAddresses)) addrMap.set(k, v);
    }
    const namedAddrArgs: string[] =
      addrMap.size > 0
        ? [
            "--named-addresses",
            Array.from(addrMap.entries())
              .map(([k, v]) => `${k}=${v}`)
              .join(","),
          ]
        : [];

    // Build step (same as Publisher — produces the bytecode the
    // subcommand will publish/upgrade).
    logger.step("Building package...");
    const buildResult = await runCli(
      {
        command: "movement",
        args: ["move", "build", "--package-dir", safeDir, ...namedAddrArgs],
        timeoutMs: 120000,
      },
      { adapter: opts.adapter }
    );
    if (buildResult.stdout) console.log(buildResult.stdout.trim());

    // Strip `ed25519-priv-` prefix if present — Movement CLI expects the
    // raw hex.
    let cleanPrivateKey = config.privateKey;
    if (cleanPrivateKey.startsWith("ed25519-priv-")) {
      cleanPrivateKey = cleanPrivateKey.replace("ed25519-priv-", "");
    }

    const movementConfigPath = join(homedir(), ".aptos", "config.yaml");

    // Register SIGINT-safe sync cleanup BEFORE writing the key (same
    // pattern as Publisher — closes bug #36).
    ensureSignalHandler();
    const syncCleanup = () => removeProfileSync(movementConfigPath, profile);
    cleanupCallbacks.add(syncCleanup);

    await withYamlLock(() =>
      addProfile(movementConfigPath, profile, {
        private_key: cleanPrivateKey,
        public_key: account.publicKey.toString(),
        account: deployerAddress,
        rest_url: config.rpc,
      })
    );

    let deployOut = "";
    try {
      logger.step(
        `Running 'movement move ${subcommand}'${subcommand === "upgrade-object" ? "" : " (this may take a moment)"}...`
      );
      const includedArtifacts: ("--included-artifacts" | string)[] =
        opts.includedArtifacts
          ? ["--included-artifacts", opts.includedArtifacts]
          : [];
      const result = await runCli(
        {
          command: "movement",
          args: [
            "move",
            subcommand,
            "--address-name",
            moduleName,
            "--package-dir",
            safeDir,
            "--url",
            config.rpc,
            "--profile",
            safeProfile,
            "--assume-yes",
            ...includedArtifacts,
            ...namedAddrArgs,
            ...opts.extraArgs,
          ],
          timeoutMs: 180000, // 3 min — deploy-object can be slow with chunked publishing.
        },
        { adapter: opts.adapter }
      );
      deployOut = result.stdout;
      if (result.stdout) console.log(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
    } finally {
      // Best-effort profile removal. CRITICAL: catch + log instead of
      // re-throwing — an await-in-finally that throws would clobber the
      // try block's success/error (the bug-#37 lesson from Publisher).
      await withYamlLock(() => removeProfile(movementConfigPath, profile)).catch(
        (err) => {
          const cleanupMsg = err instanceof Error ? err.message : String(err);
          logger.warning(
            `Failed to remove deploy profile "${profile}" from ${movementConfigPath}: ${cleanupMsg}. ` +
              `Run 'movement config delete-profile --profile ${profile}' to clean up manually.`
          );
        }
      );
      cleanupCallbacks.delete(syncCleanup);
    }

    // Parse object address (for deploy-object) and txHash (both flows).
    // No captured fixture exists at M2.2 commit time; M4 integration
    // tests validate against real CLI output.
    const objectAddress = opts.fixedAddress ?? parseObjectAddress(deployOut);
    const txHash = parseTxHash(deployOut);

    if (!objectAddress) {
      throw new Error(
        `Could not parse object address from '${subcommand}' output. ` +
          `Expected a line containing 'object address 0x...' or a JSON ` +
          `'Result' block with an 'object_address' field. Captured stdout:\n${deployOut.slice(0, 1000)}`
      );
    }

    logger.success(
      `${subcommand === "deploy-object" ? "Module deployed" : "Module upgraded"} successfully!`
    );

    // Publish/upgrade succeeded. Everything below this point that throws
    // is a local-side bookkeeping failure, not an on-chain failure.

    const deployment: DeploymentInfo = {
      address: objectAddress,
      moduleName,
      network: config.network,
      deployer: deployerAddress,
      timestamp: Date.now(),
      ...(txHash !== undefined ? { txHash } : {}),
    };

    try {
      saveDeployment(deployment);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new PostPublishError(
        `Module "${moduleName}" ${subcommand === "deploy-object" ? "deployed" : "upgraded"} to ${deployment.address} ` +
          `but local deployment record could not be written: ${err.message}`,
        deployment,
        err
      );
    }

    return deployment;
  } catch (error) {
    if (error instanceof PostPublishError) {
      logger.warning(
        `Module ${subcommand === "deploy-object" ? "deployed" : "upgraded"} successfully to ${error.deployment.address} ` +
          `(tx=${error.deployment.txHash ?? "unknown"}) but local deployment record could not be written.`
      );
      logger.warning(`   Cause: ${error.cause.message}`);
      logger.warning(
        `   To recover, manually write the deployment to deployments/${error.deployment.network}/${error.deployment.moduleName}.json.`
      );
      throw error;
    }
    if (error instanceof CliExecutionError) {
      if (error.stdoutPreview) console.log(error.stdoutPreview);
      logger.error(
        `Failed to ${subcommand === "deploy-object" ? "deploy" : "upgrade"} module: ${error.message}\n${error.stderr}`
      );
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `Failed to ${subcommand === "deploy-object" ? "deploy" : "upgrade"} module: ${err.message}`
      );
    }
    throw error;
  }
}

/**
 * Extract a code-object address from `movement move deploy-object` stdout.
 *
 * Movement CLI typically emits the address in one of these shapes (none
 * of them captured at M2.2 commit time — patterns are speculative, with
 * M4 integration tests as the validation gate):
 *
 *   - Free text: `Code was successfully deployed to object address 0x…`
 *   - Free text: `Object address: 0x…`
 *   - JSON `Result` block with `"object_address": "0x…"`
 *
 * Falls through the patterns in order. Returns `undefined` on no match.
 */
function parseObjectAddress(stdout: string): string | undefined {
  // Pattern 1: phrase-context match.
  const phraseMatch = stdout.match(
    /object\s+address[:\s]+\b(0x[a-fA-F0-9]{1,64})\b/i
  );
  if (phraseMatch?.[1]) return phraseMatch[1];

  // Pattern 2: JSON-shaped key.
  const jsonMatch = stdout.match(
    /"object_address"\s*:\s*"(0x[a-fA-F0-9]{1,64})"/
  );
  if (jsonMatch?.[1]) return jsonMatch[1];

  return undefined;
}

/**
 * Extract a transaction hash from CLI stdout. Identical regex to
 * `core/Publisher.ts` (the publish success message uses the same
 * shape) — kept here to avoid coupling.
 */
function parseTxHash(stdout: string): string | undefined {
  const withContext = stdout.match(
    /(?:transaction\s*(?:hash)?|txn\s*(?:hash)?|hash):\s*(0x[a-fA-F0-9]{64})\b/i
  );
  if (withContext?.[1]) return withContext[1];
  const fallback = stdout.match(/\b(0x[a-fA-F0-9]{64})\b/);
  return fallback?.[1];
}
