import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Harness } from "../../harness/index.js";
import { _resetConfigCache } from "../../core/config.js";

describe("Harness.createLive", () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-harness-live-"));
    writeFileSync(
      join(tmpCwd, "movehat.config.js"),
      `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet"
    },
    custom: {
      url: "https://custom.example.com/v1",
      chainId: "custom",
      accounts: ["0x${"a".repeat(64)}"]
    }
  }
};
`
    );
    const moveDir = join(tmpCwd, "move");
    mkdirSync(join(moveDir, "sources"), { recursive: true });
    writeFileSync(
      join(moveDir, "Move.toml"),
      `[package]
name = "dummy"
version = "0.0.1"

[addresses]
`
    );
    writeFileSync(join(moveDir, "sources", "dummy.move"), "// intentionally empty\n");

    origCwd = process.cwd();
    process.chdir(tmpCwd);
    _resetConfigCache();
  });

  afterEach(() => {
    try {
      process.chdir(origCwd);
    } finally {
      if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
      _resetConfigCache();
    }
  });

  it("returns a Harness bound to the requested network with mode='live'", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      expect(harness.mode).toBe("live");
      expect(harness.runtime).toBeDefined();
      expect(harness.runtime.network.name).toBe("testnet");
      expect(harness.runtime.network.rpc).toContain("testnet.movementnetwork.xyz");
      // createLive does not own a local node or fork server.
      expect(harness.localNode).toBeUndefined();
      expect(harness.forkServer).toBeUndefined();
      expect(harness.forkManager).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  it("can switch networks via the first argument", async () => {
    const harness = await Harness.createLive("custom");
    try {
      expect(harness.runtime.network.name).toBe("custom");
      expect(harness.runtime.network.rpc).toContain("custom.example.com");
    } finally {
      await harness.cleanup();
    }
  });

  it("cleanup() is a no-op for createLive (no owned services) but still poisons", async () => {
    const harness = await Harness.createLive("testnet");
    expect(harness.poisoned).toBe(false);
    await harness.cleanup();
    expect(harness.poisoned).toBe(true);
  });
});
