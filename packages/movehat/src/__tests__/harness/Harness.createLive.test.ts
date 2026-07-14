import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Harness } from "../../harness/index.js";
import { NetworkConflictError } from "../../errors.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

describe("Harness.createLive", () => {
  let fixture: HarnessTestFixture;

  beforeEach(() => {
    fixture = setupHarnessTestFixture({
      extraNetworks: {
        custom: {
          url: "https://custom.example.com/v1",
          chainId: "custom",
          accounts: ["0x" + "a".repeat(64)],
        },
      },
    });
  });

  afterEach(() => {
    fixture.teardown();
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

  it("uses config/env resolution when the network argument is omitted", async () => {
    const harness = await Harness.createLive();
    try {
      expect(harness.runtime.network.name).toBe("testnet");
    } finally {
      await harness.cleanup();
    }
  });

  it("fails before runtime construction when API and CLI networks conflict", async () => {
    const previous = process.env.MH_CLI_NETWORK;
    process.env.MH_CLI_NETWORK = "custom";
    try {
      await expect(Harness.createLive("testnet")).rejects.toBeInstanceOf(
        NetworkConflictError
      );
    } finally {
      if (previous === undefined) delete process.env.MH_CLI_NETWORK;
      else process.env.MH_CLI_NETWORK = previous;
    }
  });

  it("cleanup() is a no-op for createLive (no owned services) but still poisons", async () => {
    const harness = await Harness.createLive("testnet");
    expect(harness.poisoned).toBe(false);
    await harness.cleanup();
    expect(harness.poisoned).toBe(true);
  });
});
