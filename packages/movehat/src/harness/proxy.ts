import { HarnessDisposedError } from "./errors.js";

/**
 * Names of Harness methods that must throw `HarnessDisposedError`
 * synchronously once the harness has been disposed (via `cleanup()`).
 *
 * Properties NOT in this set — `cleanup`, `mode`, `poisoned`, the runtime
 * accessors, well-known Symbols, and the promise-protocol hooks
 * (`then`/`catch`/`finally`) — always pass through. That keeps:
 *  - `await harness` from breaking on `.then` access
 *  - debug tools (`console.log`, `util.inspect`) from throwing
 *  - idempotent `cleanup()` callable post-poisoning
 *
 * New Harness methods that should fail post-cleanup MUST be added here.
 */
const POISONED_METHODS: ReadonlySet<string> = new Set([
  "deployCodeObject",
  "upgradeCodeObject",
  "runViewFunction",
  "runMoveScript",
]);

/**
 * Wrap a Harness instance in a Proxy that throws `HarnessDisposedError`
 * synchronously on access to any method in {@link POISONED_METHODS} once
 * `isPoisoned()` returns true.
 */
export function createHarnessProxy<T extends object>(
  target: T,
  isPoisoned: () => boolean
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && POISONED_METHODS.has(prop) && isPoisoned()) {
        throw new HarnessDisposedError(prop);
      }
      return Reflect.get(obj, prop, receiver);
    },
  });
}
