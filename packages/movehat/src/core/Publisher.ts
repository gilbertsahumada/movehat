import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import * as yaml from "js-yaml";
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
import { CliExecutionError, ModuleAlreadyDeployedError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";

/** @internal */
export interface PublisherDeps {
  adapter?: ChildProcessAdapter;
}

/** @internal */
export interface PublishInput {
  moduleName: string;
  config: MovehatConfig;
  account: Account;
  packageDir?: string;
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
      const formattedMessage = [
        `\n❌ Module "${moduleName}" is already deployed on ${config.network}`,
        `   Address: ${existingDeployment.address}`,
        `   Deployed at: ${new Date(existingDeployment.timestamp).toLocaleString()}`,
        existingDeployment.txHash ? `   Transaction: ${existingDeployment.txHash}` : null,
        `\n💡 To redeploy, run with the --redeploy flag:`,
        `   movehat run <script> --network ${config.network} --redeploy\n`,
      ]
        .filter(Boolean)
        .join("\n");

      console.error(formattedMessage);

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
      console.log(`🔄 Redeploying module "${moduleName}" on ${config.network}...`);
    }

    const dir = input.packageDir || config.moveDir;
    const profile = config.profile || "default";

    // Validate (no shell escape — runCli uses spawn, which takes args
    // verbatim and would treat the single-quote wrapping as part of the
    // literal path/profile, breaking Movement CLI argument parsing).
    const safeDir = validatePathSafety(dir, "package directory");
    const safeProfile = validateProfileSafety(profile);

    console.log(`📦 Publishing module "${moduleName}" from ${dir}...`);

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
      console.log("🔨 Building package...");
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
      console.log("📤 Publishing to blockchain...");

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

      // Setup Movement CLI config with private key securely
      // Movement CLI uses .aptos config directory (not .movement)
      const movementConfigDir = join(homedir(), ".aptos");
      const movementConfigPath = join(movementConfigDir, "config.yaml");
      let originalMovementConfig = "";

      try {
        // Ensure .aptos directory exists
        if (!existsSync(movementConfigDir)) {
          mkdirSync(movementConfigDir, { recursive: true, mode: 0o700 });
        }

        // Backup original config if it exists
        if (existsSync(movementConfigPath)) {
          originalMovementConfig = await readFile(movementConfigPath, "utf-8");
        }

        // Create Movement config with private key
        // Movement CLI reads from ~/.aptos/config.yaml
        const movementConfig: any = originalMovementConfig
          ? yaml.load(originalMovementConfig)
          : {};

        // Set profile with private key
        // Use unescaped profile name as YAML key (YAML handles escaping automatically)
        if (!movementConfig.profiles) {
          movementConfig.profiles = {};
        }
        if (!movementConfig.profiles[profile]) {
          movementConfig.profiles[profile] = {};
        }

        movementConfig.profiles[profile].private_key = cleanPrivateKey;
        movementConfig.profiles[profile].public_key = account.publicKey.toString();
        movementConfig.profiles[profile].account = deployerAddress;
        movementConfig.profiles[profile].rest_url = config.rpc;

        // Write config file with restrictive permissions
        const configYaml = yaml.dump(movementConfig);
        writeFileSync(movementConfigPath, configYaml, { mode: 0o600 });

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
        // Restore original Movement config
        if (existsSync(movementConfigPath)) {
          if (originalMovementConfig) {
            // Restore original config
            writeFileSync(movementConfigPath, originalMovementConfig, { mode: 0o600 });
          } else {
            // Remove config file if it didn't exist before
            await unlink(movementConfigPath).catch(() => {});
          }
        }
        // Note: Move.toml restoration removed — bug #38 fix means
        // Move.toml is never mutated in the first place.
      }

      // Extract transaction hash from output
      // Look for patterns like "Transaction hash: 0x..." or "Txn: 0x..." or just a 64-char hex
      // The regex tries to match with context first, then falls back to any 64-char hex
      let txHash: string | undefined;
      const txHashMatchWithContext = publishOut.match(
        /(?:transaction\s*(?:hash)?|txn\s*(?:hash)?|hash):\s*(0x[a-fA-F0-9]{64})\b/i
      );
      if (txHashMatchWithContext) {
        txHash = txHashMatchWithContext[1];
      } else {
        // Fallback: try to find any 64-char hex string (exactly, not more)
        const txHashMatch = publishOut.match(/\b(0x[a-fA-F0-9]{64})\b/);
        if (txHashMatch) {
          txHash = txHashMatch[1];
        }
      }

      console.log(`✅ Module published successfully!`);

      // Create deployment info
      const deployment: DeploymentInfo = {
        address: account.accountAddress.toString(),
        moduleName,
        network: config.network,
        deployer: account.accountAddress.toString(),
        timestamp: Date.now(),
        txHash,
      };

      // Save deployment
      saveDeployment(deployment);

      return deployment;
    } catch (error: any) {
      if (error instanceof CliExecutionError) {
        // stdout/stderr are already redacted by runCli before reaching here,
        // so this branch is safe to log verbatim.
        if (error.stdoutPreview) console.log(error.stdoutPreview);
        console.error(`❌ Failed to publish module: ${error.message}\n${error.stderr}`);
      } else {
        // Preserve existing behaviour for non-CLI errors (filesystem write
        // failures from Move.toml / ~/.aptos/config.yaml, yaml parse errors,
        // etc.). These paths can't carry private-key material so logging raw
        // is safe.
        const errorMsg = error.stderr ? `${error.message}\n${error.stderr}` : error.message;
        if (error.stdout) console.log(error.stdout);
        console.error(`❌ Failed to publish module: ${errorMsg}`);
      }
      throw error;
    }
  }
}
