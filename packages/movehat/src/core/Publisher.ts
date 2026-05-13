import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { Account } from "@aptos-labs/ts-sdk";
import { MovehatConfig } from "../types/config.js";
import { extractNamedAddresses } from "../commands/compile.js";
import {
  saveDeployment,
  loadDeployment,
  DeploymentInfo,
  validateSafeName,
} from "./deployments.js";
import { validatePathSafety, validateProfileSafety } from "./shell.js";
import { CliExecutionError, ModuleAlreadyDeployedError, PostPublishError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { logger } from "../ui/index.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";
import {
  withYamlLock,
  addProfile,
  removeProfile,
  removeProfileSync,
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
 * Extracted from `runtime.deployContract` (M1.4 / #79). Carries the
 * destructive Move.toml-rewrite + shared-yaml-write semantics of the
 * original closure verbatim in this scaffold commit — bug fixes for
 * #36 / #37 / #38 land in subsequent commits.
 *
 * @internal
 */
export class Publisher {
  constructor(private readonly deps: PublisherDeps = {}) {}

  async deploy(input: PublishInput): Promise<DeploymentInfo> {
    const { moduleName, config, account } = input;

    // Validate moduleName early
    validateSafeName(moduleName, "module");

    // Check if --redeploy flag was passed via CLI
    const forceRedeploy = process.env.MH_CLI_REDEPLOY === "true";

    // Check if already deployed
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

    // Bug #37: use a UUID-suffixed profile name per deploy so concurrent
    // Publisher.deploy() calls in the same process don't fight over the
    // same key in ~/.aptos/config.yaml. The previous code reused
    // config.profile (default "default"), which meant two parallel
    // deploys would clobber each other's profile data mid-publish.
    const profile = `movehat-deploy-${randomUUID().slice(0, 8)}`;

    // Validate (no shell escape — runCli uses spawn, which takes args
    // verbatim and would treat the single-quote wrapping as part of the
    // literal path/profile, breaking Movement CLI argument parsing).
    const safeDir = validatePathSafety(dir, "package directory");
    const safeProfile = validateProfileSafety(profile);

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

      // Use parameters directly instead of relying on config file
      // Strip any ed25519-priv- prefix if present
      let cleanPrivateKey = config.privateKey;
      if (cleanPrivateKey.startsWith("ed25519-priv-")) {
        cleanPrivateKey = cleanPrivateKey.replace("ed25519-priv-", "");
      }

      // Bug #38: Move.toml is NOT mutated. All address overrides flow
      // through the `--named-addresses` flag above, which Movement CLI
      // applies during build + publish. The previous regex rewrite +
      // restore-in-finally was destructive: if the process died between
      // write and restore, the user's Move.toml stayed mutated.

      let publishOut = "";
      let publishErr = "";

      // Setup Movement CLI config with private key securely.
      // Movement CLI uses .aptos config directory (not .movement).
      const movementConfigPath = join(homedir(), ".aptos", "config.yaml");

      // Register a sync cleanup hook BEFORE writing the private key.
      // If the user Ctrl+C's (or the process is SIGTERM'd) between the
      // yaml write and our async finally, the SIGINT handler iterates
      // every registered callback and removes this deploy's profile
      // synchronously — closes bug #36 (private key persisting on disk
      // after abnormal exit).
      ensureSignalHandler();
      const syncCleanup = () => removeProfileSync(movementConfigPath, profile);
      cleanupCallbacks.add(syncCleanup);

      // Add our deploy profile under the unique key. The mutex serializes
      // read-modify-write cycles so concurrent deploys in the same process
      // can't drop each other's profiles. Other user profiles in the same
      // file are preserved untouched.
      await withYamlLock(() =>
        addProfile(movementConfigPath, profile, {
          private_key: cleanPrivateKey,
          public_key: account.publicKey.toString(),
          account: deployerAddress,
          rest_url: config.rpc,
        })
      );

      try {
        // Execute publish command without exposing private key in CLI.
        // Routed through runCli so stdout/stderr are redacted of any
        // `ed25519-priv-…` shape before reaching console.log/console.error
        // or the thrown CliExecutionError — that's bug #43.
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
              "--profile",
              safeProfile,
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
        // Always remove our profile from the shared yaml — never restore
        // a "snapshot" of the whole file (that's what the old code did,
        // and that's the bug #37 race). Removing only our key leaves
        // other concurrent deploys' profiles intact.
        //
        // CRITICAL: catch + log instead of throwing. `await` in a finally
        // block that throws will clobber both the try block's successful
        // return value AND any error already propagating. Without this
        // catch, a yaml-write failure here would mask a successful
        // publish (making the deploy look failed and inviting a redeploy)
        // or mask the real publish error.
        await withYamlLock(() => removeProfile(movementConfigPath, profile)).catch((err) => {
          const cleanupMsg = err instanceof Error ? err.message : String(err);
          logger.warning(
            `Failed to remove deploy profile "${profile}" from ${movementConfigPath}: ${cleanupMsg}. ` +
            `Run 'movement config delete-profile --profile ${profile}' to clean up manually.`
          );
        });
        // Unregister the sync cleanup hook — normal path. (The signal
        // handler stays installed for the process lifetime; cheap.)
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
