import {
  AccountAddress,
  Bool,
  Hex,
  MoveString,
  MoveVector,
  U8,
  U16,
  U32,
  U64,
  U128,
  U256,
} from "@aptos-labs/ts-sdk";

/**
 * Argument types the SDK script path accepts. Scripts have no on-chain
 * ABI, so the SDK cannot infer encodings from plain JS values — every
 * argument must arrive as a BCS wrapper instance.
 */
export type ScriptFunctionArg =
  | Bool
  | U8
  | U16
  | U32
  | U64
  | U128
  | U256
  | AccountAddress
  | MoveString
  | MoveVector<U8>;

const SUPPORTED_FORMS =
  "'bool:true', 'u8:255', 'u16:...', 'u32:...', 'u64:...', 'u128:...', " +
  "'u256:...', 'address:0x1', 'string:hello', 'hex:0xdeadbeef'";

/**
 * Parse Movement-CLI-style typed script arguments (`"u64:5"`,
 * `"address:0x1"`, ...) into the BCS wrapper instances the SDK script
 * payload requires.
 *
 * Splits each entry at the FIRST `:` so string values may themselves
 * contain colons (`"string:key:value"`). Integer values accept decimal
 * or `0x`-prefixed hex; range validation is delegated to the SDK
 * wrapper constructors, which throw on overflow.
 *
 * `vector<...>` and `raw` arguments are rejected: the CLI path remains
 * available for those (`useMovelite: false` or an explicit
 * `sdkExecute: false`).
 */
export function parseScriptArgs(args: string[]): ScriptFunctionArg[] {
  return args.map((arg) => parseScriptArg(arg));
}

function parseScriptArg(arg: string): ScriptFunctionArg {
  const sep = arg.indexOf(":");
  if (sep <= 0) {
    throw new Error(
      `Invalid script argument '${arg}': expected 'type:value'. Supported: ${SUPPORTED_FORMS}.`
    );
  }
  const type = arg.slice(0, sep).trim().toLowerCase();
  const value = arg.slice(sep + 1);

  switch (type) {
    case "bool": {
      if (value !== "true" && value !== "false") {
        throw new Error(
          `Invalid bool script argument '${arg}': value must be 'true' or 'false'.`
        );
      }
      return new Bool(value === "true");
    }
    case "u8":
      return new U8(parseIntegerArg(arg, value, Number));
    case "u16":
      return new U16(parseIntegerArg(arg, value, Number));
    case "u32":
      return new U32(parseIntegerArg(arg, value, Number));
    case "u64":
      return new U64(parseIntegerArg(arg, value, BigInt));
    case "u128":
      return new U128(parseIntegerArg(arg, value, BigInt));
    case "u256":
      return new U256(parseIntegerArg(arg, value, BigInt));
    case "address":
      return AccountAddress.from(value);
    case "string":
      return new MoveString(value);
    case "hex":
      return MoveVector.U8(Hex.fromHexInput(value).toUint8Array());
    default: {
      if (type.startsWith("vector") || type === "raw") {
        throw new Error(
          `Script argument type '${type}' is not supported on the SDK execution path ` +
            `(used automatically on the movelite backend). Run against a full Movement ` +
            `node (useMovelite: false) or pass sdkExecute: false to use the Movement CLI, ` +
            `which supports the full --args grammar.`
        );
      }
      throw new Error(
        `Unknown script argument type '${type}' in '${arg}'. Supported: ${SUPPORTED_FORMS}.`
      );
    }
  }
}

function parseIntegerArg(arg: string, value: string, cast: typeof Number): number;
function parseIntegerArg(arg: string, value: string, cast: typeof BigInt): bigint;
function parseIntegerArg(
  arg: string,
  value: string,
  cast: typeof Number | typeof BigInt
): number | bigint {
  const invalid = () =>
    new Error(
      `Invalid integer script argument '${arg}': '${value}' is not a decimal or 0x-prefixed integer.`
    );
  const trimmed = value.trim();
  // BigInt("") is 0n — reject explicitly instead of silently coercing.
  if (trimmed === "") throw invalid();
  let big: bigint;
  try {
    // BigInt handles decimal and 0x-prefixed forms, and rejects
    // fractions, exponents, and garbage that Number would coerce.
    big = BigInt(trimmed);
  } catch {
    throw invalid();
  }
  return cast === Number ? Number(big) : big;
}
