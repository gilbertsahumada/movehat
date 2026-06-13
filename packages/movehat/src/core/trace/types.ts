/**
 * TypeScript mirror of the JSON contract movelite's `/v1/transactions/trace`
 * endpoint serializes. Field names and shapes match the Rust structs exactly;
 * do not rename keys (`return` is keyed literally, `address` is nullable, etc.).
 */

/** A decoded argument or return value. `value` shape depends on `type`:
 *  primitives like `u64` arrive as strings (`"5"`); a `struct` arrives as an
 *  object keyed by field index (`{ "0": .., "1": .. }`); the unit type `()` has
 *  `value: null`. */
export interface TracedArg {
  type: string;
  value: unknown;
}

/** An event emitted within a frame. `data` is the decoded event payload. */
export interface TracedEvent {
  type: string;
  data: unknown;
}

/** A storage access. `address` is populated for `load_resource` and null for
 *  `move_to` / `borrow_global_mut`. */
export interface StorageOp {
  op: string;
  type: string;
  address: string | null;
}

/** One frame of the abort stack, innermost first. Any field may be null when
 *  the VM could not resolve it. */
export interface AbortStackEntry {
  module: string | null;
  function: string | null;
  offset: number | null;
}

/** Abort details, present only when `TraceResponse.success` is false. */
export interface AbortInfo {
  code: number;
  sub_status: number | null;
  module: string | null;
  stack: AbortStackEntry[];
}

/** A single call frame in the execution tree. */
export interface CallNode {
  kind: "function" | "native" | "script";
  module: string | null;
  function: string | null;
  type_args: string[];
  args: TracedArg[];
  /** Keyed literally as `return` to match the wire format. */
  return: TracedArg[];
  /**
   * Self gas of this frame in **internal** VM gas units. These are much larger
   * than, and NOT comparable to, the external octa `gas_used` on the response —
   * never mix the two when rendering.
   */
  gas: number;
  events: TracedEvent[];
  storage: StorageOp[];
  children: CallNode[];
}

/** The full trace response. */
export interface TraceResponse {
  txn_hash: string;
  success: boolean;
  /** Transaction-level gas in octas (the external unit). */
  gas_used: number;
  vm_status: string;
  abort: AbortInfo | null;
  root: CallNode;
}
