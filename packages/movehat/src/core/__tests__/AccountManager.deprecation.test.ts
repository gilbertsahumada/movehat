import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountManager, _resetDeprecationWarnings } from "../AccountManager.js";
import { logger } from "../../ui/index.js";

/**
 * M9.3 — Once-per-method-per-process deprecation warning on the
 * static facade.
 *
 * Pins the contract that:
 *   1. Calling any static method emits exactly ONE `logger.warning`
 *      on first invocation per process.
 *   2. Subsequent calls to the SAME static method stay silent.
 *   3. Distinct static methods each fire their own warning the first
 *      time they're called.
 *   4. The warning text includes the method name + the migration
 *      tracker URL (#270) so users can find the docs without
 *      grepping the source.
 *
 * The dedup Set is module-level — `_resetDeprecationWarnings()` is
 * the test-only escape hatch that clears it between assertions.
 *
 * When M9.4 removes the static facade, this entire test file goes
 * away alongside the F8 pinning assertions in `global-state.test.ts`.
 */
describe("AccountManager static facade — deprecation warnings (M9.3)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetDeprecationWarnings();
    // Suppress the warning from actually reaching the test runner's
    // stderr while still capturing the call shape.
    warnSpy = vi.spyOn(logger, "warning").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    _resetDeprecationWarnings();
    AccountManager.clearPool();
    _resetDeprecationWarnings(); // clearPool itself trips the warning
  });

  it("static createAccount emits a deprecation warning on first call", () => {
    AccountManager.createAccount("warn_test_account");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const message = warnSpy.mock.calls[0]![0] as string;
    expect(message).toContain("AccountManager.createAccount");
    expect(message).toContain("deprecated");
    expect(message).toContain("0.3.0");
    expect(message).toContain("harness.accounts");
    expect(message).toContain("https://github.com/gilbertsahumada/movehat/issues/270");
  });

  it("second call to the same static method does NOT emit another warning", () => {
    AccountManager.createAccount("first_call");
    AccountManager.createAccount("second_call");
    AccountManager.createAccount("third_call");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("calls to DIFFERENT static methods each fire their own first-call warning", () => {
    AccountManager.createAccount("a_account");
    AccountManager.getLabeledAccounts();
    AccountManager.getPoolSize();

    expect(warnSpy).toHaveBeenCalledTimes(3);

    const messages = warnSpy.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.includes("createAccount"))).toBe(true);
    expect(messages.some((m) => m.includes("getLabeledAccounts"))).toBe(true);
    expect(messages.some((m) => m.includes("getPoolSize"))).toBe(true);
  });

  it("instance API calls do NOT trigger deprecation warnings", () => {
    const mgr = new AccountManager();
    mgr.createAccount("instance_call");
    mgr.getLabeledAccounts();
    mgr.getPoolSize();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("_resetDeprecationWarnings clears the dedup set so the next call re-warns", () => {
    AccountManager.createAccount("before_reset");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    _resetDeprecationWarnings();

    AccountManager.createAccount("after_reset");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("warning fires BEFORE forwarding to the singleton — return value still correct", () => {
    // The forwarding still happens; the warning is additive instrumentation.
    const account = AccountManager.createAccount("forwarding_test");
    expect(account.accountAddress.toString()).toBeTypeOf("string");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
