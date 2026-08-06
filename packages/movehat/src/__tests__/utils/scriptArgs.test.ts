import { describe, expect, it } from "vitest";
import {
  AccountAddress,
  Bool,
  MoveString,
  MoveVector,
  U8,
  U16,
  U32,
  U64,
  U128,
  U256,
} from "@aptos-labs/ts-sdk";

import { parseScriptArgs } from "../../utils/scriptArgs.js";

describe("parseScriptArgs", () => {
  it("marshals every supported scalar type", () => {
    const [b, u8, u16, u32, u64, u128, u256, addr, str, hex] = parseScriptArgs([
      "bool:true",
      "u8:255",
      "u16:65535",
      "u32:4294967295",
      "u64:18446744073709551615",
      "u128:340282366920938463463374607431768211455",
      "u256:0xff",
      "address:0x1",
      "string:hello",
      "hex:0xdeadbeef",
    ]);

    expect(b).toBeInstanceOf(Bool);
    expect((b as Bool).value).toBe(true);
    expect(u8).toBeInstanceOf(U8);
    expect((u8 as U8).value).toBe(255);
    expect(u16).toBeInstanceOf(U16);
    expect((u16 as U16).value).toBe(65535);
    expect(u32).toBeInstanceOf(U32);
    expect((u32 as U32).value).toBe(4294967295);
    expect(u64).toBeInstanceOf(U64);
    expect((u64 as U64).value).toBe(18446744073709551615n);
    expect(u128).toBeInstanceOf(U128);
    expect((u128 as U128).value).toBe(
      340282366920938463463374607431768211455n
    );
    expect(u256).toBeInstanceOf(U256);
    expect((u256 as U256).value).toBe(255n);
    expect(addr).toBeInstanceOf(AccountAddress);
    expect((addr as AccountAddress).toString()).toBe("0x1");
    expect(str).toBeInstanceOf(MoveString);
    expect((str as MoveString).value).toBe("hello");
    expect(hex).toBeInstanceOf(MoveVector);
    expect((hex as MoveVector<U8>).values.map((v) => v.value)).toEqual([
      0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  it("splits at the first colon so string values keep embedded colons", () => {
    const [arg] = parseScriptArgs(["string:key:value:with:colons"]);
    expect((arg as MoveString).value).toBe("key:value:with:colons");
  });

  it("accepts decimal and 0x forms for integers", () => {
    const [dec, hexed] = parseScriptArgs(["u64:42", "u64:0x2a"]);
    expect((dec as U64).value).toBe(42n);
    expect((hexed as U64).value).toBe(42n);
  });

  it("throws on integer overflow via the SDK range check", () => {
    expect(() => parseScriptArgs(["u8:256"])).toThrow();
    expect(() => parseScriptArgs(["u64:-1"])).toThrow();
  });

  it("throws on non-integer numeric values", () => {
    expect(() => parseScriptArgs(["u64:4.2"])).toThrow(/not a decimal/);
    expect(() => parseScriptArgs(["u64:"])).toThrow(/not a decimal/);
    expect(() => parseScriptArgs(["u64:banana"])).toThrow(/not a decimal/);
  });

  it("throws on malformed bool values", () => {
    expect(() => parseScriptArgs(["bool:1"])).toThrow(/must be 'true' or 'false'/);
  });

  it("throws on entries without a type prefix", () => {
    expect(() => parseScriptArgs(["42"])).toThrow(/expected 'type:value'/);
    expect(() => parseScriptArgs([":42"])).toThrow(/expected 'type:value'/);
  });

  it("rejects vector and raw args with a pointer at the CLI path", () => {
    expect(() => parseScriptArgs(["vector<u8>:0x01"])).toThrow(
      /not supported on the SDK execution path/
    );
    expect(() => parseScriptArgs(["raw:0x01"])).toThrow(
      /not supported on the SDK execution path/
    );
  });

  it("rejects unknown types listing the supported forms", () => {
    expect(() => parseScriptArgs(["float:1.5"])).toThrow(/Supported: 'bool:true'/);
  });

  it("returns an empty array for no args", () => {
    expect(parseScriptArgs([])).toEqual([]);
  });
});
