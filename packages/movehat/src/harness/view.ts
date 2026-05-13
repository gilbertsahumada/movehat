import type { MoveFunctionId } from "@aptos-labs/ts-sdk";
import type { MovehatRuntime } from "../types/runtime.js";
import type { RunViewFunctionOptions } from "../types/harness.js";

/**
 * Execute a Move view function via the Aptos SDK (no CLI invocation).
 *
 * Returns the SDK's raw `unknown[]` — the Move boundary may return a
 * tuple of any arity. Callers destructure:
 *
 * ```ts
 * const [count] = await harness.runViewFunction({
 *   function: "0xCAFE::counter::get",
 *   functionArguments: ["0xdeployer"],
 * });
 * ```
 *
 * Works on all 3 harness modes (createLocal, createFork, createLive) —
 * view functions read on-chain state without writing.
 *
 * @internal — called from `Harness.runViewFunction`.
 */
export async function runViewFunction(
  runtime: MovehatRuntime,
  options: RunViewFunctionOptions
): Promise<unknown[]> {
  return runtime.aptos.view({
    payload: {
      function: options.function as MoveFunctionId,
      typeArguments: options.typeArguments ?? [],
      functionArguments: (options.functionArguments ?? []) as never[],
    },
  });
}
