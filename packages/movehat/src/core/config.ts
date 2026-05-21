import { pathToFileURL } from "url";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import { MovehatConfig, MovehatUserConfig } from "../types/config.js";
import { logger } from "../ui/index.js";

interface ConfigCacheEntry {
  mtimeMs: number;
  config: MovehatUserConfig;
}

// Keyed by resolved absolute path. One entry per config file the process
// has loaded. Closes #62 — the previous `?t=Date.now()` cache-bust
// created a fresh Node loader module per call.
//
// Note on concurrency: two `loadUserConfig()` calls racing on a cold
// cache may both invoke `import()`. Node's loader cache deduplicates by
// URL so both resolve to the same module, and both writers store the
// same value here. No corruption, no in-flight-promise memoization
// needed.
const configCache = new Map<string, ConfigCacheEntry>();

// Hostnames recognized as safe targets for the deterministic test key
// auto-injection. Any URL whose hostname is not in this set causes the
// test-key path to be skipped even if the network NAME is 'testnet' or
// 'local' (#40 — name-only gating was spoofable when users named a
// production-pointing network 'testnet').
const TEST_ENDPOINT_HOSTS = new Set([
  "testnet.movementnetwork.xyz",
  "localhost",
  "127.0.0.1",
  "::1",
]);

function isKnownTestEndpoint(url: string): boolean {
  try {
    return TEST_ENDPOINT_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Loads the user's movehat.config.{ts,js} from the current working directory.
 *
 * Cached by `{ absPath, mtimeMs }`: a second call with no edit returns
 * the parsed object directly and skips both the tsx loader register
 * dance and the dynamic `import()`. Edits invalidate via the file's
 * mtime.
 *
 * @throws {Error} If the configuration file is not found or fails to load
 * @security This function loads and executes code from the current working directory.
 *           It should only be called from trusted project directories.
 */
export async function loadUserConfig(): Promise<MovehatUserConfig> {
  const cwd = process.cwd();

  const possiblePaths = [
    join(cwd, "movehat.config.ts"),
    join(cwd, "movehat.config.js"),
  ];

  let configPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      configPath = path;
      break;
    }
  }

  if (!configPath) {
    throw new Error(
      "Configuration file not found. Expected 'movehat.config.ts' or 'movehat.config.js' in the current directory."
    );
  }

  try {
    const { mtimeMs } = statSync(configPath);

    const cached = configCache.get(configPath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.config;
    }

    let configModule;

    if (configPath.endsWith('.ts')) {
      const { register } = await import('tsx/esm/api');
      const unregister = register();

      try {
        const configUrl = pathToFileURL(configPath).href;
        configModule = await import(configUrl + '?mtime=' + mtimeMs);
      } finally {
        unregister();
      }
    } else {
      const configUrl = pathToFileURL(configPath).href;
      configModule = await import(configUrl + '?mtime=' + mtimeMs);
    }

    const userConfig = configModule.default as MovehatUserConfig;

    if (!userConfig.networks || Object.keys(userConfig.networks).length === 0) {
      throw new Error(
        "No networks defined in configuration. Add at least one network in the 'networks' field."
      );
    }

    configCache.set(configPath, { mtimeMs, config: userConfig });

    return userConfig;
  } catch (error) {
    throw new Error(`Failed to load configuration file '${configPath}': ${error}`);
  }
}

/**
 * Clear the in-memory config cache. Test-only escape hatch.
 *
 * @internal Not part of the public API surface. Imported via relative
 *           path from `core/__tests__/config.test.ts` only.
 */
export function _resetConfigCache(): void {
  configCache.clear();
}

/**
 * Resolve configuration for a specific network
 * Merges global settings with network-specific settings
 */
export async function resolveNetworkConfig(
  userConfig: MovehatUserConfig,
  networkName?: string
): Promise<MovehatConfig> {
  // Determine which network to use
  // Default to "testnet" for testing with simulation
  const selectedNetwork =
    networkName ||
    process.env.MH_CLI_NETWORK ||
    process.env.MH_DEFAULT_NETWORK ||
    userConfig.defaultNetwork ||
    "testnet";

  // Check if network exists in config
  let networkConfig = userConfig.networks[selectedNetwork];

  // Special case: Auto-generate config for testnet (public test network)
  // This provides a better dev experience - no local setup required
  if (!networkConfig && selectedNetwork === "testnet") {
    networkConfig = {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
    };
    logger.info("testnet not found in config - using default Movement testnet configuration");
  }

  // Special case: Auto-generate config for local fork server
  if (!networkConfig && selectedNetwork === "local") {
    networkConfig = {
      url: "http://localhost:8080/v1",
      chainId: "local",
    };
    logger.info("Local network not found in config - using default fork server configuration");
  }

  if (!networkConfig) {
    const availableNetworks = Object.keys(userConfig.networks).join(", ");
    throw new Error(
      `Network '${selectedNetwork}' not found in configuration.\nAvailable networks: ${availableNetworks}, testnet (auto-generated), local (auto-generated)`
    );
  }

  // Get accounts using Hardhat-style resolution:
  // 1. Network-specific accounts (if defined)
  // 2. Global accounts from config (if defined)
  // 3. PRIVATE_KEY environment variable (Hardhat-style, no MH_ prefix)
  // 4. Error if nothing found

  let accounts: string[] = [];

  // 1. Check network-specific accounts
  if (networkConfig.accounts && networkConfig.accounts.length > 0) {
    accounts = [...networkConfig.accounts].filter(Boolean);
  }

  // 2. If no network-specific accounts, use global accounts
  if (accounts.length === 0 && userConfig.accounts && userConfig.accounts.length > 0) {
    accounts = [...userConfig.accounts].filter(Boolean);
  }

  // 3. If still no accounts, check PRIVATE_KEY env var (Hardhat-style)
  if (accounts.length === 0 && process.env.PRIVATE_KEY) {
    accounts = [process.env.PRIVATE_KEY];
  }

  // 4. Validate we have at least one account (unless using testnet/local
  //    AND the URL is a recognized test endpoint — name alone is not enough
  //    per #40, since a user can name a network 'testnet' but point it at
  //    a production RPC and would otherwise inherit the deterministic test
  //    key with a production endpoint).
  if (accounts.length === 0 || !accounts[0]) {
    const isTestNetworkName =
      selectedNetwork === "testnet" || selectedNetwork === "local";
    const isTestEndpoint =
      isTestNetworkName && isKnownTestEndpoint(networkConfig.url);

    if (isTestNetworkName && !isTestEndpoint) {
      // Name matches the reserved convention but URL is not a recognized
      // test endpoint — block the deterministic test-key injection. Falls
      // through to the standard "no accounts" throw below so the user gets
      // actionable guidance.
      logger.warning(
        `Network '${selectedNetwork}' uses a name reserved for testnet/local ` +
          `but '${networkConfig.url}' is not a recognized test endpoint. ` +
          `Skipping auto-injection of the deterministic test key to protect ` +
          `against accidental production use. Set PRIVATE_KEY explicitly, ` +
          `configure 'accounts' in movehat.config.ts, or rename this network.`
      );
    }

    if (isTestEndpoint) {
      // Security: Using a deterministic test account (like Hardhat's default accounts)
      // This is SAFE because:
      // 1. Only used for testnet/local against a known test endpoint
      //    (network NAME + URL allowlist enforced above; bypassed otherwise)
      // 2. Perfect for transaction simulation (no real funds)
      // 3. Deterministic = consistent test results
      const testPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
      accounts = [testPrivateKey];
      logger.newline();
      logger.warning("[TESTNET] Using auto-generated test account (safe for testing only)");
      logger.warning("[TESTNET] For mainnet, set PRIVATE_KEY in .env");
      logger.newline();
    } else {
      // For any other network (mainnet, or testnet/local with a non-test
      // URL), REQUIRE explicit configuration. This prevents accidentally
      // using the test key on production networks.
      throw new Error(
        `Network '${selectedNetwork}' has no accounts configured.\n` +
        `\n` +
        `SECURITY: This network requires explicit account configuration.\n` +
        `\n` +
        `Options:\n` +
        `  1. Set PRIVATE_KEY in your .env file (recommended for ${selectedNetwork})\n` +
        `  2. Add 'accounts: ["0x..."]' globally in movehat.config.ts\n` +
        `  3. Add 'accounts: ["0x..."]' to the '${selectedNetwork}' network config\n` +
        `\n` +
        `For testing without configuration, use:\n` +
        `  movehat <command> --network testnet (auto-generates safe test accounts)`
      );
    }
  }

  // Merge named addresses (network-specific overrides global)
  const mergedNamedAddresses = {
    ...(userConfig.namedAddresses || {}),
    ...(networkConfig.namedAddresses || {}),
  };

  // Capture the primary key after the L178 guard guaranteed it exists
  // (either present from the start, or auto-assigned by the testnet/local
  // branch; the else-branch throws). Pulling into a local lets TS see
  // the non-undefined narrowing.
  const primaryKey = accounts[0];
  if (!primaryKey) {
    throw new Error("invariant: accounts[0] must exist after the L178 guard");
  }

  // Derive the deployer account address from the resolved private key.
  // Without this, consumers reading `config.account` got an empty string
  // (the previous "Will be derived from privateKey in runtime" TODO was
  // never wired). Falls back to "" on malformed keys so we don't break
  // existing callers that don't need the field.
  const accountAddress = deriveAccountAddress(primaryKey);

  // Build resolved config
  const resolvedConfig: MovehatConfig = {
    network: selectedNetwork,
    rpc: networkConfig.url,
    privateKey: primaryKey,
    allAccounts: accounts,
    profile: networkConfig.profile || "default",
    moveDir: userConfig.moveDir || "./move",
    account: accountAddress,
    namedAddresses: mergedNamedAddresses,
    networkConfig: networkConfig,
  };

  return resolvedConfig;
}

/**
 * Derive the on-chain account address from a private key. Strips the
 * `ed25519-priv-` prefix that Movement CLI sometimes emits; returns ""
 * on any parse failure so existing callers that don't consume the field
 * keep working unchanged. Emits a console.warn on failure so a
 * misconfigured `PRIVATE_KEY` surfaces here (loud, at config-resolution
 * time) instead of as a cryptic "Hex string is too short" SDK error
 * later in the call chain.
 */
function deriveAccountAddress(privateKeyHex: string | undefined): string {
  if (!privateKeyHex) return "";
  try {
    // Format into AIP-80 shape so the SDK doesn't emit a deprecation
    // warning on each derivation. `formatPrivateKey` is idempotent for
    // already-prefixed inputs.
    const formatted = PrivateKey.formatPrivateKey(
      privateKeyHex,
      PrivateKeyVariants.Ed25519,
    );
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(formatted),
    });
    return account.accountAddress.toString();
  } catch (err) {
    // The private key may have come from several sources (network.accounts,
    // global accounts, PRIVATE_KEY env, auto-generated testnet key). Keep
    // the hint generic so it never points at the wrong source.
    logger.warning(
      `Could not derive account address from the resolved private key: ${
        (err as Error).message
      }. Verify the key configured for this network is a valid Ed25519 private key (with or without the "ed25519-priv-" prefix).`
    );
    return "";
  }
}
