import { Account, Aptos, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MovehatConfig } from "../types/config.js";
import { extractNamedAddresses } from "../commands/compile.js";
import {
  saveDeployment,
  loadDeployment,
  DeploymentInfo,
  assertDeploymentEnvironment,
  fingerprintRpcUrl,
  hashBuildArtifacts,
  sanitizeRpcUrl,
  validateSafeName,
} from "./deployments.js";
import { validatePathSafety } from "./shell.js";
import { CliExecutionError, ModuleAlreadyDeployedError, PostPublishError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { logger, isVerbose } from "../ui/index.js";
import { withSpinner } from "../ui/spinner.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";
import {
  writeTempKeyFile,
  removeKeyFile,
  removeKeyFileSyncBestEffort,
  ensureSignalHandler,
  cleanupCallbacks,
} from "./movementProfile.js";
import { parseTxHash } from "../utils/parseCliOutput.js";
import { withKeyedLock } from "../utils/keyedMutex.js";
import { withFileLocks } from "../utils/fileLock.js";
import { isHexAddress } from "../utils/address.js";

/** @internal */
export interface PublisherDeps {
  adapter?: ChildProcessAdapter | undefined;
}

/** @internal */
export interface PublishInput {
  moduleName: string;
  config: MovehatConfig;
  account: Account;
  packageDir?: string | undefined;
  /**
   * Publish via the TypeScript SDK instead of the Movement CLI. Set when the
   * backend is movelite, whose REST responses the Movement CLI cannot parse.
   * Requires `aptos`.
   */
  sdkPublish?: boolean | undefined;
  aptos?: Aptos | undefined;
  /**
   * Skip the already-deployed check and overwrite the deployment record.
   * Falls back to `MH_CLI_REDEPLOY=true` (set by the CLI's --redeploy flag)
   * when omitted.
   */
  redeploy?: boolean | undefined;
}

/**
 * Publishes a Move module via the Movement CLI.
 *
 * @internal
 */
export class Publisher {
  constructor(private readonly deps: PublisherDeps = {}) {}

  async deploy(input: PublishInput): Promise<DeploymentInfo> {
    const { moduleName, config } = input;

    validateSafeName(moduleName, "module");

    const dir = input.packageDir || config.moveDir;

    // Validate (no shell escape — runCli uses spawn, which takes args
    // verbatim and would treat the single-quote wrapping as part of the
    // literal path, breaking Movement CLI argument parsing).
    const safeDir = validatePathSafety(dir, "package directory");

    // Serialize per package dir: the build step writes in-place to
    // <safeDir>/build/ with the deployer address baked into the bytecode,
    // and the SDK publish path reads those bytes back from disk — a
    // concurrent deploy of the same package would publish bytecode
    // compiled for the other deploy's address. Locking from the
    // already-deployed check through saveDeployment also closes the
    // check-then-publish TOCTOU for same-module deploys.
    const chainIdentity = config.networkConfig.chainId ?? config.network;
    return withKeyedLock(resolve(safeDir), () =>
      withFileLocks(
        [
          `package:${resolve(safeDir)}`,
          `deployment:${chainIdentity}:${moduleName}`,
        ],
        () => this.deployLocked(input, dir, safeDir),
      ),
    );
  }

  private async deployLocked(
    input: PublishInput,
    dir: string,
    safeDir: string,
  ): Promise<DeploymentInfo> {
    const { moduleName, config, account } = input;

    const forceRedeploy =
      input.redeploy ?? process.env.MH_CLI_REDEPLOY === "true";

    const existingDeployment = loadDeployment(config.network, moduleName);
    if (existingDeployment) {
      assertDeploymentEnvironment(existingDeployment, {
        ...(config.networkConfig.chainId !== undefined
          ? { chainId: config.networkConfig.chainId }
          : {}),
        rpc: config.rpc,
      });
    }
    if (existingDeployment && !forceRedeploy) {
      // Build detailed error message with all deployment info
      const errorDetails = [
        `Module "${moduleName}" is already deployed on ${config.network}`,
        `Address: ${existingDeployment.address}`,
        `Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`,
        existingDeployment.txHash ? `Transaction: ${existingDeployment.txHash}` : null,
        `\nTo redeploy, run with the --redeploy flag:`,
        `movehat run <script> --network ${config.network} --redeploy`,
      ]
        .filter(Boolean)
        .join("\n");

      // Log formatted error message for user
      logger.error(`Module "${moduleName}" is already deployed on ${config.network}`);
      logger.plain(`   Address: ${existingDeployment.address}`);
      logger.plain(
        `   Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`
      );
      if (existingDeployment.txHash) {
        logger.plain(`   Transaction: ${existingDeployment.txHash}`);
      }
      logger.newline();
      logger.info("To redeploy, run with the --redeploy flag:");
      logger.plain(`   movehat run <script> --network ${config.network} --redeploy`);
      logger.newline();

      // Throw custom error with complete context for programmatic handling
      throw new ModuleAlreadyDeployedError(
        errorDetails,
        moduleName,
        config.network,
        existingDeployment.address,
        existingDeployment.timestamp,
        existingDeployment.txHash
      );
    }

    if (forceRedeploy && existingDeployment) {
      logger.info(`Redeploying module "${moduleName}" on ${config.network}...`);
    }

    logger.section("Transaction preflight");
    logger.kv("Operation", forceRedeploy ? "redeploy" : "publish", 2);
    logger.kv("Network", config.network, 2);
    logger.kv("Chain ID", config.networkConfig.chainId ?? "unknown", 2);
    logger.kv("RPC", sanitizeRpcUrl(config.rpc), 2);
    logger.kv("Signer", account.accountAddress.toString(), 2);
    logger.kv("Module", moduleName, 2);
    logger.newline();

    logger.step(`Publishing module "${moduleName}" from ${dir}...`);

    try {
      // Get the deployer address to use for named addresses
      const deployerAddress = account.accountAddress.toString();

      // Detect named addresses from Move files
      const detectedAddresses = extractNamedAddresses(dir);

      // Build named addresses argument. Explicit runtime configuration wins;
      // unresolved names retain the legacy deployer-address default.
      // Stored as a pre-split args fragment so the spawn path never has to parse
      // shell tokens; an empty fragment becomes a no-op via spread.
      const namedAddrArgs: string[] =
        detectedAddresses.size > 0
          ? [
              "--named-addresses",
              Array.from(detectedAddresses)
                .map((name) => {
                  const address = config.namedAddresses[name] ?? deployerAddress;
                  if (!isHexAddress(address)) {
                    throw new Error(
                      `Named address '${name}' must be a 1-64 digit hexadecimal address`,
                    );
                  }
                  return `${name}=${address}`;
                })
                .join(","),
            ]
          : [];

      // The SDK publish path reads package-metadata.bcs from the build
      // output; `--save-metadata` makes the build emit it. The CLI path
      // doesn't need it (`move publish` rebuilds metadata internally).
      const saveMetadataArgs = input.sdkPublish ? ["--save-metadata"] : [];

      // Build first with named addresses
      const buildResult = await withSpinner(
        "Building package",
        () =>
          runCli(
            {
              command: "movement",
              args: [
                "move",
                "build",
                "--package-dir",
                safeDir,
                ...namedAddrArgs,
                ...saveMetadataArgs,
              ],
              timeoutMs: 120000, // 2 minutes for git dependency downloads
            },
            { adapter: this.deps.adapter }
          ),
      );
      if (isVerbose() && buildResult.stdout) {
        logger.info(buildResult.stdout.trim(), 2);
      }

      // Publish the freshly-built package. movelite cannot consume the
      // Movement CLI's `move publish` REST flow (its responses omit the
      // ledger headers and fields the CLI requires), so when the backend
      // is movelite we publish via the TypeScript SDK instead. Every other
      // backend keeps the CLI path.
      const txHash = input.sdkPublish
        ? await this.publishViaSdk(input, safeDir)
        : await this.publishViaCli(config, safeDir, deployerAddress, namedAddrArgs);

      logger.success("Module published successfully!");

      // ←← "Publish succeeded" boundary. Anything thrown below this
      // point did NOT cause the publish to fail — the module is on
      // chain. We surface those failures as PostPublishError so callers
      // can distinguish a genuine publish failure from a local
      // bookkeeping failure (and avoid a wasteful redeploy).

      const artifactHash = hashBuildArtifacts(safeDir);
      const deployment: DeploymentInfo = {
        address: account.accountAddress.toString(),
        moduleName,
        network: config.network,
        deployer: account.accountAddress.toString(),
        timestamp: Date.now(),
        txHash,
        schemaVersion: 2,
        ...(config.networkConfig.chainId !== undefined
          ? { chainId: config.networkConfig.chainId }
          : {}),
        rpcFingerprint: fingerprintRpcUrl(config.rpc),
        ...(artifactHash !== undefined ? { artifactHash } : {}),
        kind: "publish",
      };

      try {
        saveDeployment(deployment);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        throw new PostPublishError(
          `Module "${moduleName}" published to ${deployment.address} ` +
          `but local deployment record could not be written: ${err.message}`,
          deployment,
          err
        );
      }

      return deployment;
    } catch (error) {
      if (error instanceof PostPublishError) {
        // Publish DID succeed; only local persistence failed. Log as
        // warning (not error) so the user knows the deploy is real on
        // chain. Re-throw so programmatic callers can react.
        logger.warning(
          `Module published successfully to ${error.deployment.address} ` +
          `(tx=${error.deployment.txHash ?? "unknown"}) ` +
          `but local deployment record could not be written.`
        );
        logger.warning(`   Cause: ${error.cause.message}`);
        logger.warning(
          `   To recover, manually write the deployment to ` +
          `deployments/${error.deployment.network}/${error.deployment.moduleName}.json.`
        );
        throw error;
      }
      if (error instanceof CliExecutionError) {
        // stdout/stderr are already redacted by runCli before reaching here,
        // so this branch is safe to log verbatim.
        if (error.stdoutPreview) logger.info(error.stdoutPreview, 2);
        logger.error(`Failed to publish module: ${error.message}\n${error.stderr}`);
      } else {
        // Preserve existing behaviour for non-CLI errors (filesystem write
        // failures from Move.toml / ~/.aptos/config.yaml, yaml parse errors,
        // etc.). These paths can't carry private-key material so logging raw
        // is safe.
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Failed to publish module: ${err.message}`);
      }
      throw error;
    }
  }

  /**
   * Publish via the Movement CLI (`movement move publish`). The default path
   * for real Movement nodes, forks, and testnet. Returns the parsed tx hash.
   */
  private async publishViaCli(
    config: MovehatConfig,
    safeDir: string,
    deployerAddress: string,
    namedAddrArgs: string[]
  ): Promise<string | undefined> {
    // Format the private key into AIP-80 shape so the Movement CLI
    // doesn't emit its raw-hex deprecation warning. `formatPrivateKey`
    // is idempotent for already-prefixed inputs.
    const formattedPrivateKey = PrivateKey.formatPrivateKey(
      config.privateKey,
      PrivateKeyVariants.Ed25519,
    );

    // Move.toml is NOT mutated. All address overrides flow through
    // the `--named-addresses` flag above, which Movement CLI applies
    // during build + publish. Rewriting Move.toml on disk would risk
    // leaving the user's file mutated if the process died before the
    // restore step.

    let publishOut: string;
    let publishErr: string;

    // Pass the private key to Movement CLI via a 0o600 temp file
    // (`--private-key-file <path>`) and the on-chain address via
    // `--sender-account <addr>`. This avoids the CLI's profile-yaml
    // lookup chain entirely — no CWD / HOME / .aptos / .movement
    // dance, no CLI-variant dependency.
    const keyFilePath = writeTempKeyFile(formattedPrivateKey);

    // Register a sync cleanup hook BEFORE invoking the CLI. If the
    // user Ctrl+C's (or the process is SIGTERM'd) between the file
    // write and our finally, the SIGINT handler iterates every
    // registered callback and unlinks this deploy's key file
    // synchronously so the private key never persists on disk after
    // an abnormal exit. The signal-handler path uses the
    // best-effort variant because the event loop is dead and we
    // cannot logger.warning.
    ensureSignalHandler();
    const syncCleanup = () => removeKeyFileSyncBestEffort(keyFilePath);
    cleanupCallbacks.add(syncCleanup);

    try {
      // Execute publish command. Private key reaches the CLI via the
      // temp key file path (--private-key-file) — never on the
      // command line — so it can't leak through `ps aux`. runCli's
      // stdout/stderr redaction still applies as defense in depth
      // for any `ed25519-priv-…` substring that surfaces in CLI
      // output (Movement CLI sometimes echoes the key on error).
      const publishResult = await withSpinner(
        "Publishing to blockchain",
        () =>
          runCli(
            {
              command: "movement",
              args: [
                "move",
                "publish",
                "--package-dir",
                safeDir,
                "--url",
                config.rpc,
                "--private-key-file",
                keyFilePath,
                "--sender-account",
                deployerAddress,
                "--assume-yes",
                ...namedAddrArgs,
              ],
              timeoutMs: 120000, // 2 minutes for blockchain transactions
            },
            { adapter: this.deps.adapter }
          ),
      );
      publishOut = publishResult.stdout;
      publishErr = publishResult.stderr;
      // Both stdout and stderr from the publish subprocess are gated
      // behind isVerbose() — Movement CLI emits progress to both
      // streams ("Compiling, may take a little while..."), so a
      // visible stderr line is not by itself a failure signal. The
      // surrounding withSpinner converts the runCli throw on real
      // failure into the visible spinner.fail() output instead.
      if (isVerbose() && publishOut) logger.info(publishOut.trim(), 2);
      if (isVerbose() && publishErr) logger.info(publishErr.trim(), 2);
    } finally {
      // Unlink the temp key file via the observable cleanup helper.
      // ENOENT and other already-gone outcomes are benign (null).
      // A non-null Error means the unlink failed AND the file still
      // exists on disk — the private key would persist silently
      // otherwise, so we emit a warning with the manual-cleanup
      // hint. The SIGINT signal handler's sync callback below also
      // tries to remove the same file; if SIGINT fires before this
      // finally runs the file is gone and the next finally call
      // sees ENOENT (benign).
      const cleanupErr = removeKeyFile(keyFilePath);
      if (cleanupErr) {
        logger.warning(
          `Failed to remove temp key file '${keyFilePath}': ${cleanupErr.message}. ` +
            `The file has mode 0o600 but should be removed manually: rm ${keyFilePath}`
        );
      }
      cleanupCallbacks.delete(syncCleanup);
    }

    // Extract transaction hash from output via the shared helper
    // (`utils/parseCliOutput.ts`). Same regex pair as before; lifted
    // for reuse by harness/codeObject.ts and harness/script.ts.
    return parseTxHash(publishOut);
  }

  /**
   * Publish the already-built package via the TypeScript SDK. Used when the
   * backend is movelite. Reads the compiled artifacts the CLI build produced
   * under `<dir>/build/<pkg>/`, submits a `0x1::code::publish_package_txn`,
   * and waits for it. Returns the on-chain tx hash.
   */
  private async publishViaSdk(
    input: PublishInput,
    safeDir: string
  ): Promise<string> {
    const aptos = input.aptos;
    if (!aptos) {
      throw new Error("sdkPublish requires an Aptos client");
    }

    const buildRoot = join(safeDir, "build");
    // The root package's compiled output is the single directory under
    // build/ that carries a package-metadata.bcs; dependency builds live
    // in nested bytecode_modules/dependencies/ and have no metadata here.
    const pkgDirs = existsSync(buildRoot)
      ? readdirSync(buildRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(buildRoot, e.name))
          .filter((d) => existsSync(join(d, "package-metadata.bcs")))
      : [];
    if (pkgDirs.length !== 1) {
      throw new Error(
        `Expected exactly one compiled package under ${buildRoot}, found ${pkgDirs.length}.`
      );
    }
    const pkgDir = pkgDirs[0]!;

    const metadataBytes = new Uint8Array(
      readFileSync(join(pkgDir, "package-metadata.bcs"))
    );
    const modulesDir = join(pkgDir, "bytecode_modules");
    const moduleBytecode = readdirSync(modulesDir)
      .filter((f) => f.endsWith(".mv"))
      .sort()
      .map((f) => new Uint8Array(readFileSync(join(modulesDir, f))));
    if (moduleBytecode.length === 0) {
      throw new Error(`No compiled modules (*.mv) found in ${modulesDir}`);
    }

    return withSpinner("Publishing to blockchain", async () => {
      const tx = await aptos.publishPackageTransaction({
        account: input.account.accountAddress,
        metadataBytes,
        moduleBytecode,
      });
      const senderAuth = aptos.transaction.sign({
        signer: input.account,
        transaction: tx,
      });
      const committed = await aptos.transaction.submit.simple({
        transaction: tx,
        senderAuthenticator: senderAuth,
      });
      await aptos.waitForTransaction({ transactionHash: committed.hash });
      return committed.hash;
    });
  }
}
