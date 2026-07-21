import { PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
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
  assertDeploymentEnvironment,
  fingerprintRpcUrl,
  tryHashBuildArtifacts,
  sanitizeRpcUrl,
  validateSafeName,
  type DeploymentInfo,
} from "../core/deployments.js";
import { validatePathSafety } from "../core/shell.js";
import {
  CliExecutionError,
  ModuleAlreadyDeployedError,
  PostPublishError,
  TransactionOutcomeUnknownError,
} from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { parseTxHash } from "../utils/parseCliOutput.js";
import { logger, isVerbose } from "../ui/index.js";
import {
  writeTempKeyFile,
  removeKeyFile,
  removeKeyFileSyncBestEffort,
  ensureSignalHandler,
  cleanupCallbacks,
} from "../core/movementProfile.js";
import { withKeyedLock } from "../utils/keyedMutex.js";
import { withFileLocks } from "../utils/fileLock.js";
import { isHexAddress, normalizeAddress } from "../utils/address.js";
import { deploymentLockKeys } from "../utils/deploymentLockKeys.js";

function validateMoveIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `${label} '${value}' is not a valid Move identifier; expected [A-Za-z_][A-Za-z0-9_]*`,
    );
  }
}

/**
 * Deploy a Move package as a code object via `movement move deploy-object`.
 *
 * Mirrors `core/Publisher.deploy` exactly for the security-critical parts
 * (per-deploy unique temp key file, per-package-dir deploy lock shared
 * with the Publisher, SIGINT-safe sync cleanup, stderr redaction via
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
    addressName: options.addressName,
    packageDir: options.packageDir,
    namedAddresses: options.namedAddresses,
    includedArtifacts: options.includedArtifacts,
    adapter: options.adapter,
    subcommand: "deploy-object",
    extraArgs: [],
    checkIdempotency: true,
    redeploy: options.redeploy,
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
    addressName: options.addressName,
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
  /**
   * Move.toml named address for the `--address-name` CLI flag.
   * Defaults to `moduleName` when undefined.
   */
  addressName?: string | undefined;
  packageDir?: string | undefined;
  namedAddresses?: Record<string, string> | undefined;
  includedArtifacts?: "none" | "sparse" | "all" | undefined;
  adapter?: import("../utils/childProcessAdapter.js").ChildProcessAdapter | undefined;
  subcommand: "deploy-object" | "upgrade-object";
  extraArgs: readonly string[];
  /** Whether to throw `ModuleAlreadyDeployedError` if a record exists. */
  checkIdempotency: boolean;
  /**
   * Skip the already-deployed check and overwrite the deployment record.
   * Falls back to `MH_CLI_REDEPLOY=true` when omitted.
   */
  redeploy?: boolean | undefined;
  /**
   * For upgrade-object: the object's existing address. Skips the parse-
   * from-stdout step (the address is known up front).
   */
  fixedAddress?: string;
}

async function executeMovementMoveObject(
  opts: ExecuteOptions
): Promise<CodeObjectInfo> {
  const { runtime, moduleName } = opts;
  const config = runtime.config;

  validateSafeName(moduleName, "module");
  validateMoveIdentifier(moduleName, "Module name");
  validateMoveIdentifier(opts.addressName ?? moduleName, "Address name");

  const dir = opts.packageDir || config.moveDir;
  const safeDir = validatePathSafety(dir, "package directory");

  // Serialize per package dir, sharing the Publisher's lock map: both
  // write paths build in-place into <safeDir>/build/, so a concurrent
  // deploy of the same package (through either path) could publish
  // bytecode compiled for the other deploy's address. Upgrade builds
  // too, so it takes the lock as well.
  const chainIdentity = config.networkConfig.chainId ?? config.network;
  const lockScope = deploymentLockKeys({
    packageDir: safeDir,
    chainIdentity,
    moduleName,
  });
  return withKeyedLock(lockScope.canonicalPackageDir, () =>
    withFileLocks(
      lockScope.keys,
      () => executeMovementMoveObjectLocked(opts, dir, safeDir),
      { timeoutMs: 360_000, onWait: (message) => logger.info(message) },
    ),
  );
}

async function executeMovementMoveObjectLocked(
  opts: ExecuteOptions,
  dir: string,
  safeDir: string,
): Promise<CodeObjectInfo> {
  const { runtime, moduleName, subcommand } = opts;
  const config = runtime.config;
  const account = runtime.account;

  // Idempotency: deploy-object refuses re-deploy unless MH_CLI_REDEPLOY=true.
  // Upgrade does not check this (the whole point is to overwrite).
  const forceRedeploy =
    opts.redeploy ?? process.env.MH_CLI_REDEPLOY === "true";
  const existing = loadDeployment(config.network, moduleName, {
    quarantineCorrupt: forceRedeploy,
  });
  if (existing) {
    assertDeploymentEnvironment(existing, {
      ...(config.networkConfig.chainId !== undefined
        ? { chainId: config.networkConfig.chainId }
        : {}),
      rpc: config.rpc,
      allowRpcMismatch: forceRedeploy,
    });
  }
  if (
    subcommand === "upgrade-object" &&
    existing &&
    normalizeAddress(existing.address) !== normalizeAddress(opts.fixedAddress ?? "")
  ) {
    throw new Error(
      `Upgrade object '${opts.fixedAddress}' does not match recorded deployment '${existing.address}'`,
    );
  }
  if (opts.checkIdempotency) {
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

  logger.section("Transaction preflight");
  logger.kv("Operation", subcommand, 2);
  logger.kv("Network", config.network, 2);
  logger.kv("Chain ID", config.networkConfig.chainId ?? "unknown", 2);
  logger.kv("RPC", sanitizeRpcUrl(config.rpc), 2);
  logger.kv("Signer", account.accountAddress.toString(), 2);
  logger.kv("Module", moduleName, 2);
  if (opts.fixedAddress) logger.kv("Object", opts.fixedAddress, 2);
  logger.newline();

  logger.step(
    `${subcommand === "deploy-object" ? "Deploying" : "Upgrading"} module "${moduleName}" from ${dir}...`
  );
  const rpcFingerprint = fingerprintRpcUrl(config.rpc);

  try {
    const deployerAddress = account.accountAddress.toString();

    // Build named-addresses arg: auto-detected names from Move sources
    // are bound to the deployer's address (Publisher convention).
    // Caller-supplied `namedAddresses` overlay on top.
    const detectedAddresses = extractNamedAddresses(dir);
    const addrMap = new Map<string, string>();
    for (const name of detectedAddresses) {
      addrMap.set(name, config.namedAddresses[name] ?? deployerAddress);
    }
    if (opts.namedAddresses) {
      for (const [k, v] of Object.entries(opts.namedAddresses)) addrMap.set(k, v);
    }
    for (const [name, address] of addrMap) {
      validateMoveIdentifier(name, "Named address");
      if (!isHexAddress(address)) {
        throw new Error(
          `Named address '${name}' must be a 1-64 digit hexadecimal address`,
        );
      }
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
    if (isVerbose() && buildResult.stdout) logger.info(buildResult.stdout.trim(), 2);

    // Format the private key into AIP-80 shape so the Movement CLI
    // doesn't emit its raw-hex deprecation warning. `formatPrivateKey`
    // is idempotent for already-prefixed inputs.
    const formattedPrivateKey = PrivateKey.formatPrivateKey(
      config.privateKey,
      PrivateKeyVariants.Ed25519,
    );

    // Pass the private key via a 0o600 temp file (--private-key-file)
    // and the on-chain address via --sender-account. This avoids the
    // CLI's profile-yaml lookup entirely — no CWD / HOME / .aptos /
    // .movement dance, no CLI-variant dependency.
    const keyFilePath = writeTempKeyFile(formattedPrivateKey);

    // Register SIGINT-safe sync cleanup BEFORE invoking the CLI so
    // the private key never persists on disk after an abnormal exit.
    // The signal-handler path uses the best-effort variant because the
    // event loop is dead and we cannot logger.warning.
    ensureSignalHandler();
    const syncCleanup = () => removeKeyFileSyncBestEffort(keyFilePath);
    cleanupCallbacks.add(syncCleanup);

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
            opts.addressName ?? moduleName,
            "--package-dir",
            safeDir,
            "--url",
            config.rpc,
            "--private-key-file",
            keyFilePath,
            "--sender-account",
            deployerAddress,
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
      // Both streams gated behind isVerbose(); see §9 — stream channel
      // is not by itself a failure signal. Real failures throw via
      // CliExecutionError and are surfaced from the catch below.
      if (isVerbose() && result.stdout) logger.info(result.stdout.trim(), 2);
      if (isVerbose() && result.stderr) logger.info(result.stderr.trim(), 2);
    } finally {
      // Unlink via the observable helper — emit a warning if the file
      // could not be removed AND still exists on disk (private key
      // would persist silently otherwise). ENOENT and races are
      // treated as benign success.
      const cleanupErr = removeKeyFile(keyFilePath);
      if (cleanupErr) {
        logger.warning(
          `Failed to remove temp key file '${keyFilePath}': ${cleanupErr.message}. ` +
            `The file has mode 0o600 but should be removed manually: rm ${keyFilePath}`
        );
      }
      cleanupCallbacks.delete(syncCleanup);
    }

    // Parse object address (for deploy-object) and txHash (both flows).
    const objectAddress = opts.fixedAddress ?? parseObjectAddress(deployOut);
    const txHash = parseTxHash(deployOut);

    if (!objectAddress) {
      throw new TransactionOutcomeUnknownError(
        `'movement move ${subcommand}' exited successfully, but the object address could not be parsed. ` +
          `Do not retry automatically; inspect the transaction on-chain first.`,
        subcommand,
        txHash,
        deployOut
      );
    }

    logger.success(
      `${subcommand === "deploy-object" ? "Module deployed" : "Module upgraded"} successfully!`
    );

    // Publish/upgrade succeeded. Everything below this point that throws
    // is a local-side bookkeeping failure, not an on-chain failure.

    const artifactHash = tryHashBuildArtifacts(safeDir, (error) => {
      logger.warning(`Module is on-chain, but build artifacts could not be inspected: ${error.message}`);
    });
    const deployment: DeploymentInfo = {
      address: objectAddress,
      moduleName,
      network: config.network,
      deployer: deployerAddress,
      timestamp: Date.now(),
      ...(txHash !== undefined ? { txHash } : {}),
      schemaVersion: 2,
      ...(config.networkConfig.chainId !== undefined
        ? { chainId: config.networkConfig.chainId }
        : {}),
      rpcFingerprint,
      ...(artifactHash !== undefined ? { artifactHash } : {}),
      kind: subcommand === "deploy-object" ? "code-object" : "upgrade-object",
      ...(subcommand === "upgrade-object" && existing?.txHash !== undefined
        ? { previousTxHash: existing.txHash }
        : {}),
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
    if (error instanceof TransactionOutcomeUnknownError) {
      logger.warning(error.message);
      if (error.txHash) logger.warning(`   Transaction: ${error.txHash}`);
      logger.warning("   Do not retry automatically; inspect the transaction on-chain first.");
      throw error;
    }
    if (error instanceof CliExecutionError) {
      if (error.stdoutPreview) logger.info(error.stdoutPreview, 2);
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
 * Movement CLI typically emits the address in one of these shapes:
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
