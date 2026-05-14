import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Harness, HarnessDisposedError } from "../../harness/index.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

/**
 * Proxy poisoning is the load-bearing safety guarantee of M2: once a
 * Harness has been cleaned up, any further deploy / view / script /
 * upgrade call must throw `HarnessDisposedError` synchronously on
 * property access — not after the awaited method body. These tests
 * lock that contract.
 *
 * Uses `Harness.createLive(network)` because it does not spawn a real
 * Movement node — `initRuntime` only constructs the SDK client (no RPC
 * round-trip) from the fixture config. `createLocal` / `createFork`
 * runtime tests live in the M4 integration suite where spinning a real
 * node is acceptable.
 */
describe("Harness — proxy poisoning", () => {
  let fixture: HarnessTestFixture;

  beforeEach(() => {
    fixture = setupHarnessTestFixture();
  });

  afterEach(() => {
    fixture.teardown();
  });

  it("cleanup() flips poisoned to true", async () => {
    const harness = await Harness.createLive("testnet");
    expect(harness.poisoned).toBe(false);
    await harness.cleanup();
    expect(harness.poisoned).toBe(true);
  });

  it("cleanup() is idempotent", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();
    // Second call must not throw and must leave the harness poisoned.
    await expect(harness.cleanup()).resolves.toBeUndefined();
    expect(harness.poisoned).toBe(true);
  });

  it("post-cleanup, deployCodeObject throws HarnessDisposedError synchronously on property access", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // Property access itself throws — the call site never gets a Promise back.
    // The args ({moduleName: "x"}) typecheck but never execute (the get trap
    // fires before the method body runs).
    expect(() => harness.deployCodeObject({ moduleName: "x" })).toThrow(
      HarnessDisposedError
    );
  });

  it("post-cleanup, upgradeCodeObject / runViewFunction / runMoveScript all throw HarnessDisposedError synchronously", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    expect(() =>
      harness.upgradeCodeObject({ moduleName: "x", objectAddress: "0x1" })
    ).toThrow(HarnessDisposedError);
    expect(() =>
      harness.runViewFunction({ function: "0x1::m::f" })
    ).toThrow(HarnessDisposedError);
    expect(() =>
      harness.runMoveScript({ scriptPath: "irrelevant.move" })
    ).toThrow(HarnessDisposedError);
  });

  it("HarnessDisposedError carries the offending method name", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    let captured: unknown;
    try {
      harness.deployCodeObject({ moduleName: "x" });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HarnessDisposedError);
    expect((captured as HarnessDisposedError).methodName).toBe("deployCodeObject");
  });

  it("post-cleanup, metadata accessors (mode, poisoned, runtime) still work", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // None of these should throw — only the 4 poisoned methods do.
    expect(harness.mode).toBe("live");
    expect(harness.poisoned).toBe(true);
    expect(harness.runtime).toBeDefined();
  });

  // The M2.3-era "stubs reject" assertion was retired when M2.3 shipped
  // real bodies for runViewFunction and runMoveScript. All four methods
  // now have dedicated test suites (codeObject.deploy/upgrade.test.ts,
  // view.test.ts, script.test.ts).

  it("await harness.someAsyncMethod() pattern: post-cleanup throw happens before await", async () => {
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();

    // The error is synchronous (property access), but the typical caller
    // shape uses await. Confirm that pattern surfaces the error too.
    let captured: unknown;
    try {
      await harness.deployCodeObject({ moduleName: "x" });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HarnessDisposedError);
  });
});
