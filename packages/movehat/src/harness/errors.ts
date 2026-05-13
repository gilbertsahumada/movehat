/**
 * Thrown synchronously when any method other than `cleanup` is invoked
 * on a Harness instance whose `cleanup()` has already run.
 *
 * The throw happens on property access (Proxy `get` trap), not after the
 * async method body. That means `await harness.deployCodeObject(...)`
 * throws *before* the call site awaits — callers can use a plain
 * `try`/`catch` or rely on the rejected promise; either form will fire.
 */
export class HarnessDisposedError extends Error {
  constructor(public readonly methodName: string) {
    super(
      `Harness is disposed; call to '${methodName}' is not allowed. ` +
        `Create a new Harness via Harness.createLocal/createFork/createLive instead.`
    );
    this.name = "HarnessDisposedError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HarnessDisposedError);
    }
  }
}
