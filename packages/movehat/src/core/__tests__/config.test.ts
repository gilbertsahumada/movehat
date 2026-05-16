import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUserConfig, resolveNetworkConfig, _resetConfigCache } from "../config.js";
import type { MovehatUserConfig } from "../../types/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_A = `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: { url: "https://testnet.movementnetwork.xyz/v1", chainId: "testnet" }
  }
};
`;

const CONFIG_B = `export default {
  defaultNetwork: "mainnet",
  networks: {
    mainnet: { url: "https://mainnet.movementnetwork.xyz/v1", chainId: "mainnet" }
  }
};
`;

describe("loadUserConfig — mtime cache", () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    _resetConfigCache();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-config-test-"));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("first call reads from disk", async () => {
    writeFileSync(join(tmpCwd, "movehat.config.js"), CONFIG_A);

    const config = await loadUserConfig();

    expect(config.defaultNetwork).toBe("testnet");
    expect(config.networks).toHaveProperty("testnet");
  });

  it("second call returns the same parsed object (cache hit)", async () => {
    writeFileSync(join(tmpCwd, "movehat.config.js"), CONFIG_A);

    const first = await loadUserConfig();
    const second = await loadUserConfig();

    // Reference equality proves we returned the cached object rather
    // than re-importing and getting a structurally-equal copy.
    expect(second).toBe(first);
  });

  it("mtime change invalidates the cache", async () => {
    const path = join(tmpCwd, "movehat.config.js");
    writeFileSync(path, CONFIG_A);

    const first = await loadUserConfig();
    expect(first.defaultNetwork).toBe("testnet");

    // Rewrite + force an mtime far in the future so we don't depend on
    // filesystem mtime resolution.
    writeFileSync(path, CONFIG_B);
    const future = new Date(Date.now() + 60_000);
    utimesSync(path, future, future);

    const second = await loadUserConfig();

    expect(second).not.toBe(first);
    expect(second.defaultNetwork).toBe("mainnet");
    expect(second.networks).toHaveProperty("mainnet");
  });

  it("different cwds keep separate cache entries", async () => {
    writeFileSync(join(tmpCwd, "movehat.config.js"), CONFIG_A);
    const fromA = await loadUserConfig();
    expect(fromA.defaultNetwork).toBe("testnet");

    const tmpCwdB = mkdtempSync(join(tmpdir(), "movehat-config-test-b-"));
    try {
      process.chdir(tmpCwdB);
      writeFileSync(join(tmpCwdB, "movehat.config.js"), CONFIG_B);
      const fromB = await loadUserConfig();
      expect(fromB.defaultNetwork).toBe("mainnet");

      // Switching back to A returns A's cached entry, not B's — proves
      // the cache is keyed by absolute path, not by something process-
      // scoped like "the last value loaded".
      process.chdir(tmpCwd);
      const fromAagain = await loadUserConfig();
      expect(fromAagain).toBe(fromA);
      expect(fromAagain.defaultNetwork).toBe("testnet");
    } finally {
      process.chdir(tmpCwd);
      rmSync(tmpCwdB, { recursive: true, force: true });
    }
  });

  it("source file does not contain the `?t=` cache-bust pattern", () => {
    const configSrc = readFileSync(join(__dirname, "..", "config.ts"), "utf-8");

    expect(configSrc).not.toMatch(/\?t=['"]\s*\+\s*Date\.now/);
  });

  // Note: there's no direct behavioral test for `_resetConfigCache()`.
  // The function is exercised in `beforeEach` above — if it didn't
  // actually clear the in-memory map, tests 3 and 4 would leak state
  // between each other and start failing. Its "test" is therefore the
  // rest of this suite continuing to pass.

  it("throws when no movehat.config.{ts,js} is present", async () => {
    // tmpCwd is empty (no config written) — should reject with the
    // 'Configuration file not found' message.
    await expect(loadUserConfig()).rejects.toThrow(/Configuration file not found/);
  });

  it("rejects a config with empty `networks`", async () => {
    writeFileSync(
      join(tmpCwd, "movehat.config.js"),
      `export default { networks: {} };
`
    );
    await expect(loadUserConfig()).rejects.toThrow(/No networks defined/);
  });
});

const TEST_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

const baseUserConfig = (networks: MovehatUserConfig["networks"]): MovehatUserConfig => ({
  networks,
});

describe("resolveNetworkConfig", () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot.PRIVATE_KEY = process.env.PRIVATE_KEY;
    envSnapshot.MH_CLI_NETWORK = process.env.MH_CLI_NETWORK;
    envSnapshot.MH_DEFAULT_NETWORK = process.env.MH_DEFAULT_NETWORK;
    delete process.env.PRIVATE_KEY;
    delete process.env.MH_CLI_NETWORK;
    delete process.env.MH_DEFAULT_NETWORK;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses the network passed as the argument over defaultNetwork", async () => {
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
      b: { url: "https://b.example.com/v1", chainId: "b", accounts: [TEST_KEY] },
    });
    user.defaultNetwork = "a";
    const resolved = await resolveNetworkConfig(user, "b");
    expect(resolved.network).toBe("b");
    expect(resolved.rpc).toBe("https://b.example.com/v1");
  });

  it("MH_CLI_NETWORK env var overrides defaultNetwork when no arg is passed", async () => {
    process.env.MH_CLI_NETWORK = "b";
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
      b: { url: "https://b.example.com/v1", chainId: "b", accounts: [TEST_KEY] },
    });
    user.defaultNetwork = "a";
    const resolved = await resolveNetworkConfig(user);
    expect(resolved.network).toBe("b");
  });

  it("MH_DEFAULT_NETWORK env var is the next-lower priority after MH_CLI_NETWORK", async () => {
    process.env.MH_DEFAULT_NETWORK = "b";
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
      b: { url: "https://b.example.com/v1", chainId: "b", accounts: [TEST_KEY] },
    });
    user.defaultNetwork = "a";
    const resolved = await resolveNetworkConfig(user);
    expect(resolved.network).toBe("b");
  });

  it("auto-generates a testnet config when 'testnet' is missing from user networks", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
    });
    const resolved = await resolveNetworkConfig(user, "testnet");
    expect(resolved.network).toBe("testnet");
    expect(resolved.rpc).toBe("https://testnet.movementnetwork.xyz/v1");
    logSpy.mockRestore();
  });

  it("auto-generates a local config when 'local' is missing from user networks", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
    });
    const resolved = await resolveNetworkConfig(user, "local");
    expect(resolved.network).toBe("local");
    expect(resolved.rpc).toBe("http://localhost:8080/v1");
    logSpy.mockRestore();
  });

  it("throws on a completely unknown network with a clear list of available ones", async () => {
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
    });
    await expect(resolveNetworkConfig(user, "nonexistent")).rejects.toThrow(
      /Network 'nonexistent' not found/
    );
  });

  it("falls back to PRIVATE_KEY env var when no accounts are configured anywhere", async () => {
    process.env.PRIVATE_KEY = TEST_KEY;
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a" },
    });
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.privateKey).toBe(TEST_KEY);
    expect(resolved.allAccounts).toEqual([TEST_KEY]);
  });

  it("auto-generates a deterministic test key for testnet when no accounts are anywhere", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = baseUserConfig({
      testnet: { url: "https://testnet.movementnetwork.xyz/v1", chainId: "testnet" },
    });
    const resolved = await resolveNetworkConfig(user, "testnet");
    // The auto-generated key is the canonical Hardhat-style test key.
    expect(resolved.privateKey).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
    logSpy.mockRestore();
  });

  it("rejects a non-testnet/local network with no accounts (security gate)", async () => {
    const user = baseUserConfig({
      mainnet: { url: "https://mainnet.movementnetwork.xyz/v1", chainId: "mainnet" },
    });
    await expect(resolveNetworkConfig(user, "mainnet")).rejects.toThrow(
      /requires explicit account configuration/
    );
  });

  it("prefers network-specific accounts over global ones", async () => {
    const user: MovehatUserConfig = {
      accounts: ["0xglobal"],
      networks: {
        a: {
          url: "https://a.example.com/v1",
          chainId: "a",
          accounts: [TEST_KEY],
        },
      },
    };
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.privateKey).toBe(TEST_KEY);
  });

  it("falls back to global accounts when network has none", async () => {
    const user: MovehatUserConfig = {
      accounts: [TEST_KEY],
      networks: {
        a: { url: "https://a.example.com/v1", chainId: "a" },
      },
    };
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.privateKey).toBe(TEST_KEY);
  });

  it("merges named addresses, with network-specific overriding global", async () => {
    const user: MovehatUserConfig = {
      namedAddresses: { foo: "0xglobal", shared: "0xglobal" },
      networks: {
        a: {
          url: "https://a.example.com/v1",
          chainId: "a",
          accounts: [TEST_KEY],
          namedAddresses: { bar: "0xnet", shared: "0xnet" },
        },
      },
    };
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.namedAddresses).toEqual({
      foo: "0xglobal",
      bar: "0xnet",
      shared: "0xnet",
    });
  });

  it("derives the on-chain account address from the resolved key", async () => {
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
    });
    const resolved = await resolveNetworkConfig(user, "a");
    // The canonical Hardhat-style 0x...01 key derives to a well-known address.
    expect(resolved.account).toMatch(/^0x[a-f0-9]+$/i);
    expect(resolved.account.length).toBeGreaterThan(2);
  });

  it("returns account='' and warns when the configured key is malformed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: ["not-a-real-key"] },
    });
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.account).toBe("");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Could not derive account address/)
    );
    warnSpy.mockRestore();
  });

  it("strips the 'ed25519-priv-' prefix when deriving the account address", async () => {
    const user = baseUserConfig({
      a: {
        url: "https://a.example.com/v1",
        chainId: "a",
        accounts: [`ed25519-priv-${TEST_KEY}`],
      },
    });
    const resolved = await resolveNetworkConfig(user, "a");
    // Same key, prefixed and unprefixed, should derive the same address.
    const bareResolved = await resolveNetworkConfig(
      baseUserConfig({
        a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
      }),
      "a"
    );
    expect(resolved.account).toBe(bareResolved.account);
  });

  it("uses profile='default' when networkConfig has no profile", async () => {
    const user = baseUserConfig({
      a: { url: "https://a.example.com/v1", chainId: "a", accounts: [TEST_KEY] },
    });
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.profile).toBe("default");
  });

  it("respects networkConfig.profile when set", async () => {
    const user: MovehatUserConfig = {
      networks: {
        a: {
          url: "https://a.example.com/v1",
          chainId: "a",
          accounts: [TEST_KEY],
          profile: "custom-profile",
        },
      },
    };
    const resolved = await resolveNetworkConfig(user, "a");
    expect(resolved.profile).toBe("custom-profile");
  });
});
