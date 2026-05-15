import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Harness } from "../../harness/index.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

/**
 * Tests for `Harness.runViewFunction` — the SDK delegation path.
 *
 * The Aptos SDK isn't behind an injectable adapter, so we monkey-patch
 * `harness.runtime.aptos.view` after `createLive`. Acceptable here
 * because the function under test is a 6-line wrapper that only
 * forwards options.
 */
describe("Harness.runViewFunction", () => {
  let fixture: HarnessTestFixture;

  beforeEach(() => {
    fixture = setupHarnessTestFixture();
  });

  afterEach(() => {
    fixture.teardown();
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
