import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Harness } from "../../harness/index.js";
import { _resetConfigCache } from "../../core/config.js";

/**
 * Tests for `Harness.runViewFunction` — the SDK delegation path.
 *
 * The Aptos SDK isn't behind an injectable adapter, so we monkey-patch
 * `harness.runtime.aptos.view` after `createLive`. One-off for M2.3.
 * Acceptable here because the function under test is a 6-line wrapper
 * that only forwards options.
 */
describe("Harness.runViewFunction", () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-view-"));
    writeFileSync(
      join(tmpCwd, "movehat.config.js"),
      `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet"
    }
  }
};
`
    );
    const moveDir = join(tmpCwd, "move");
    mkdirSync(join(moveDir, "sources"), { recursive: true });
    writeFileSync(
      join(moveDir, "Move.toml"),
      `[package]\nname = "dummy"\nversion = "0.0.1"\n\n[addresses]\n`
    );
    writeFileSync(join(moveDir, "sources", "dummy.move"), "// empty\n");

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

  it("happy path: forwards correct payload to aptos.view and returns the raw result array", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      const fake = vi.fn().mockResolvedValue([42n, "hello"]);
      // Monkey-patch — the SDK boundary isn't behind an adapter.
      harness.runtime.aptos.view = fake as never;

      const result = await harness.runViewFunction({
        function: "0xCAFE::counter::get",
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: ["0xdeployer", 1n],
      });

      expect(result).toEqual([42n, "hello"]);
      expect(fake).toHaveBeenCalledTimes(1);
      expect(fake).toHaveBeenCalledWith({
        payload: {
          function: "0xCAFE::counter::get",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: ["0xdeployer", 1n],
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("defaults typeArguments and functionArguments to empty arrays when omitted", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      const fake = vi.fn().mockResolvedValue([0n]);
      harness.runtime.aptos.view = fake as never;

      const result = await harness.runViewFunction({
        function: "0xCAFE::counter::count",
      });

      expect(result).toEqual([0n]);
      expect(fake).toHaveBeenCalledWith({
        payload: {
          function: "0xCAFE::counter::count",
          typeArguments: [],
          functionArguments: [],
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("passes empty results through unchanged", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      const fake = vi.fn().mockResolvedValue([]);
      harness.runtime.aptos.view = fake as never;

      const result = await harness.runViewFunction({
        function: "0xCAFE::nothing::nothing",
      });

      expect(result).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("rethrows errors from aptos.view", async () => {
    const harness = await Harness.createLive("testnet");
    try {
      const fake = vi.fn().mockRejectedValue(new Error("module not found"));
      harness.runtime.aptos.view = fake as never;

      await expect(
        harness.runViewFunction({ function: "0xCAFE::missing::get" })
      ).rejects.toThrow(/module not found/);
    } finally {
      await harness.cleanup();
    }
  });
});
