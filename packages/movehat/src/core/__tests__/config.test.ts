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

describe("loadUserConfig — mtime cache (#81, #62)", () => {
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

  it("source file no longer contains the `?t=` cache-bust (#62 regression guard)", () => {
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

  // Regression coverage for #47 — concurrent cold-cache loads of the
  // same config previously raced on tsx's register/unregister cycle
  // (for .ts files). The in-flight dedup map makes concurrent callers
  // share one Promise regardless of extension.
  //
  // Note: tests use .js fixtures because vitest's vite-node loader
  // collides with tsx's `register()` in-process (`Invalid loader value`
  // error). The dedup mechanism lives BEFORE the .ts/.js branch in
  // doLoadConfig — proving dedup with .js proves it for .ts in
  // production where vitest is not in the loader chain.
  describe("concurrent load dedup (#47)", () => {
    it("Promise.all on cold cache returns the same loaded object", async () => {
      writeFileSync(join(tmpCwd, "movehat.config.js"), CONFIG_A);

      const [a, b, c] = await Promise.all([
        loadUserConfig(),
        loadUserConfig(),
        loadUserConfig(),
      ]);

      // Reference equality proves all three callers received the SAME
      // resolved module — only one load actually ran.
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a.defaultNetwork).toBe("testnet");
    });

    it("Promise.all rejection propagates the same error to all callers", async () => {
      // Config without `networks` triggers the validation throw inside
      // doLoadConfig, exercising the rejection path of the in-flight
      // promise.
      writeFileSync(
        join(tmpCwd, "movehat.config.js"),
        `export default { networks: {} };
`
      );

      const results = await Promise.allSettled([
        loadUserConfig(),
        loadUserConfig(),
      ]);

      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");
      const r0 = results[0] as PromiseRejectedResult;
      const r1 = results[1] as PromiseRejectedResult;
      // Both callers see the same wrapped "Failed to load configuration"
      // error (each catch produces a new Error instance, but the message
      // and inner cause are identical — proves dedup serialized the
      // single underlying failure to both).
      expect(String(r0.reason)).toBe(String(r1.reason));
      expect(String(r0.reason)).toMatch(/No networks defined|Failed to load/);
    });

    it("sequential calls after a concurrent burst still hit cache normally", async () => {
      writeFileSync(join(tmpCwd, "movehat.config.js"), CONFIG_A);

      // Cold-cache concurrent burst.
      const [first] = await Promise.all([loadUserConfig(), loadUserConfig()]);
      // Sequential call after the burst — should be a cache hit, same
      // reference, no new load.
      const sequential = await loadUserConfig();
      expect(sequential).toBe(first);
    });
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

  // Regression coverage for #40 — auto-injection of the deterministic test
  // key (0x0..01) was previously gated only on the network NAME being
  // 'testnet' / 'local'. A user-named 'testnet' pointing at a production
  // URL silently inherited the weak key. Now name AND URL host must match.
  describe("test-key auto-injection gate (#40)", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("injects test key for 'testnet' network with canonical Movement testnet URL", async () => {
      const user = baseUserConfig({
        testnet: {
          url: "https://testnet.movementnetwork.xyz/v1",
          chainId: "testnet",
        },
      });
      const resolved = await resolveNetworkConfig(user, "testnet");
      expect(resolved.privateKey).toBe(
        "0x0000000000000000000000000000000000000000000000000000000000000001"
      );
    });

    it("injects test key for 'local' network with localhost URL", async () => {
      const user = baseUserConfig({
        local: { url: "http://localhost:8080/v1", chainId: "local" },
      });
      const resolved = await resolveNetworkConfig(user, "local");
      expect(resolved.privateKey).toBe(
        "0x0000000000000000000000000000000000000000000000000000000000000001"
      );
    });

    it("REFUSES to inject test key when 'testnet' name points at a non-test URL (the #40 trap)", async () => {
      const user = baseUserConfig({
        testnet: { url: "https://prod.example.com/v1", chainId: "testnet" },
      });
      await expect(resolveNetworkConfig(user, "testnet")).rejects.toThrow(
        /has no accounts configured/
      );
      const warningMessages = warnSpy.mock.calls.map((c) => c.join(" "));
      expect(
        warningMessages.some((m) => /not a recognized test endpoint/i.test(m))
      ).toBe(true);
    });

    it("REFUSES to inject test key when 'local' name points at a remote URL", async () => {
      const user = baseUserConfig({
        local: { url: "https://prod.example.com/v1", chainId: "local" },
      });
      await expect(resolveNetworkConfig(user, "local")).rejects.toThrow(
        /has no accounts configured/
      );
    });

    it("sanitizes URL credentials and query params in the warning (CR #265)", async () => {
      // URLs with userinfo or API keys should never leak into logs.
      const user = baseUserConfig({
        testnet: {
          url: "https://alice:s3cr3t@prod.example.com/v1?apiKey=sk-private",
          chainId: "testnet",
        },
      });
      await expect(resolveNetworkConfig(user, "testnet")).rejects.toThrow(
        /has no accounts configured/
      );
      const warningMessages = warnSpy.mock.calls.map((c) => c.join(" "));
      const warnText = warningMessages.find((m) =>
        /not a recognized test endpoint/i.test(m)
      );
      expect(warnText).toBeDefined();
      // Sanitized: must drop userinfo + query string.
      expect(warnText!).not.toContain("alice");
      expect(warnText!).not.toContain("s3cr3t");
      expect(warnText!).not.toContain("apiKey");
      expect(warnText!).not.toContain("sk-private");
      // But keep enough for the operator to identify the endpoint.
      expect(warnText!).toContain("prod.example.com");
    });

    it("treats 127.0.0.1 as a known test endpoint", async () => {
      const user = baseUserConfig({
        local: { url: "http://127.0.0.1:8080/v1", chainId: "local" },
      });
      const resolved = await resolveNetworkConfig(user, "local");
      expect(resolved.privateKey).toBe(
        "0x0000000000000000000000000000000000000000000000000000000000000001"
      );
    });

    it("rejects malformed URLs without injecting (URL parser returns false)", async () => {
      const user = baseUserConfig({
        testnet: { url: "not-a-url", chainId: "testnet" },
      });
      await expect(resolveNetworkConfig(user, "testnet")).rejects.toThrow(
        /has no accounts configured/
      );
    });
  });
});
