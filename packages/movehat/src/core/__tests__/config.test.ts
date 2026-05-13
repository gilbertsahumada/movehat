import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { loadUserConfig, _resetConfigCache } from "../config.js";

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
});
