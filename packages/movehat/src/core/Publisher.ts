import { Account, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import { MovehatConfig } from "../types/config.js";
import { extractNamedAddresses } from "../commands/compile.js";
import {
  saveDeployment,
  loadDeployment,
  DeploymentInfo,
  validateSafeName,
} from "./deployments.js";
import { validatePathSafety } from "./shell.js";
import { CliExecutionError, ModuleAlreadyDeployedError, PostPublishError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { logger } from "../ui/index.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";
import {
  writeTempKeyFile,
  removeKeyFile,
  removeKeyFileSyncBestEffort,
  ensureSignalHandler,
  cleanupCallbacks,
} from "./movementProfile.js";
import { parseTxHash } from "../utils/parseCliOutput.js";

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
}

/**
 * Publishes a Move module via the Movement CLI.
 *
 * @internal
 */
export class Publisher {
  constructor(private readonly deps: PublisherDeps = {}) {}

  async deploy(input: PublishInput): Promise<DeploymentInfo> {
    const { moduleName, config, account } = input;

    validateSafeName(moduleName, "module");

    const forceRedeploy = process.env.MH_CLI_REDEPLOY === "true";

    const existingDeployment = loadDeployment(config.network, moduleName);
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

    const dir = input.packageDir || config.moveDir;

    // Validate (no shell escape — runCli uses spawn, which takes args
    // verbatim and would treat the single-quote wrapping as part of the
    // literal path, breaking Movement CLI argument parsing).
    const safeDir = validatePathSafety(dir, "package directory");

    logger.step(`Publishing module "${moduleName}" from ${dir}...`);

    try {
      // Get the deployer address to use for named addresses
      const deployerAddress = account.accountAddress.toString();

      // Detect named addresses from Move files
      const detectedAddresses = extractNamedAddresses(dir);

      // Build named addresses argument - use deployer address for all detected addresses.
      // Stored as a pre-split args fragment so the spawn path never has to parse
      // shell tokens; an empty fragment becomes a no-op via spread.
      const namedAddrArgs: string[] =
        detectedAddresses.size > 0
          ? [
              "--named-addresses",
              Array.from(detectedAddresses)
                .map((name) => `${name}=${deployerAddress}`)
                .join(","),
            ]
          : [];

      // Build first with named addresses
      logger.step("Building package...");
      const buildResult = await runCli(
        {
          command: "movement",
          args: ["move", "build", "--package-dir", safeDir, ...namedAddrArgs],
          timeoutMs: 120000, // 2 minutes for git dependency downloads
        },
        { adapter: this.deps.adapter }
      );
      if (buildResult.stdout) console.log(buildResult.stdout.trim());

      // Publish using direct parameters (avoid config file issues)
      logger.step("Publishing to blockchain...");

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

      let publishOut = "";
      let publishErr = "";

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
        const publishResult = await runCli(
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
        );
        publishOut = publishResult.stdout;
        publishErr = publishResult.stderr;
        if (publishOut) console.log(publishOut.trim());
        if (publishErr) console.error(publishErr.trim());
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
      const txHash = parseTxHash(publishOut);

      logger.success("Module published successfully!");

      // ←← "Publish succeeded" boundary. Anything thrown below this
      // point did NOT cause the publish to fail — the module is on
      // chain. We surface those failures as PostPublishError so callers
      // can distinguish a genuine publish failure from a local
      // bookkeeping failure (and avoid a wasteful redeploy).

      const deployment: DeploymentInfo = {
        address: account.accountAddress.toString(),
        moduleName,
        network: config.network,
        deployer: account.accountAddress.toString(),
        timestamp: Date.now(),
        txHash,
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
        if (error.stdoutPreview) console.log(error.stdoutPreview);
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
}
