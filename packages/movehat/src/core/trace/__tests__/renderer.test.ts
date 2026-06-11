import { describe, expect, it } from "vitest";

import { formatTraceLines } from "../renderer.js";
import type { CallNode, TraceResponse } from "../types.js";
import sample from "./fixtures/counter-increment.json" with { type: "json" };

const real = sample as unknown as TraceResponse;
const text = (lines: string[]) => lines.join("\n");

// Minimal CallNode factory for crafted fixtures.
const node = (over: Partial<CallNode>): CallNode => ({
  kind: "function",
  module: "0xabc::user",
  function: "f",
  type_args: [],
  args: [],
  return: [],
  gas: 100,
  events: [],
  storage: [],
  children: [],
  ...over,
});

describe("formatTraceLines — real counter-increment fixture", () => {
  it("level 2: flat event list + footer, no call tree", () => {
    const out = text(formatTraceLines(real, 2, 5));
    expect(out).toContain("Events");
    expect(out).toMatch(/emit .*::counter::Incremented/);
    // No tree frame label for the entry function at level 2.
    expect(out).not.toContain("increment(");
    expect(out).toMatch(/gas_used: \d+ octas/);
    expect(out).toContain("traced in 5ms");
  });

  it("level 3: shows the user frame, filters 0x1:: framework frames", () => {
    const out = text(formatTraceLines(real, 3, 5));
    expect(out).toContain("::counter::increment(");
    // Framework helpers are hidden at level 3.
    expect(out).not.toContain("0x1::signer");
    expect(out).not.toContain("0x1::event");
  });

  it("level 4: shows framework frames, natives, storage, and returns", () => {
    const out = text(formatTraceLines(real, 4, 5));
    expect(out).toContain("0x1::signer::address_of");
    expect(out).toContain("0x1::event::emit");
    expect(out).toContain("load_resource");
    expect(out).toContain("←"); // a return value from a framework helper
  });

  it("never emits raw ANSI escape codes (color is gated)", () => {
    for (const lvl of [2, 3, 4]) {
      expect(text(formatTraceLines(real, lvl, 5))).not.toContain("\x1b[");
    }
  });

  it("shortens long addresses in frame paths", () => {
    const out = text(formatTraceLines(real, 3, 5));
    expect(out).toMatch(/0x[0-9a-f]{4}\.\.[0-9a-f]{4}::counter/);
  });
});

describe("formatTraceLines — level 3 event bubbling", () => {
  it("surfaces an event emitted by a hidden framework frame under the user ancestor", () => {
    const trace: TraceResponse = {
      txn_hash: "0x1",
      success: true,
      gas_used: 10,
      vm_status: "Executed successfully",
      abort: null,
      root: node({
        module: "0xabc::user",
        function: "do_thing",
        children: [
          node({
            kind: "function",
            module: "0x1::event",
            function: "emit",
            events: [{ type: "0xabc::user::Did", data: { ok: true } }],
            children: [
              node({
                kind: "native",
                module: "0x1::event",
                function: "write_module_event_to_store",
              }),
            ],
          }),
        ],
      }),
    };

    const out = text(formatTraceLines(trace, 3, 1));
    // The user frame shows...
    expect(out).toContain("0xabc::user::do_thing");
    // ...the event bubbles up even though its emitting frame is hidden...
    expect(out).toContain("emit 0xabc::user::Did");
    // ...and the framework frame itself stays hidden at level 3.
    expect(out).not.toContain("0x1::event::emit");
  });
});

describe("formatTraceLines — abort", () => {
  const aborted: TraceResponse = {
    txn_hash: "0x9",
    success: false,
    gas_used: 7,
    vm_status: "Move abort",
    abort: {
      code: 1,
      sub_status: null,
      module: "0xabc::user",
      stack: [
        { module: "0xabc::user", function: "guard", offset: 14 },
        { module: null, function: null, offset: null },
      ],
    },
    root: node({
      module: "0xabc::user",
      function: "do_thing",
      children: [
        node({ kind: "native", module: "0x1::vector", function: "borrow" }),
      ],
    }),
  };

  it("renders the abort header, stack, and a failed footer", () => {
    const out = text(formatTraceLines(aborted, 3, 2));
    expect(out).toMatch(/Aborted: code 1/);
    expect(out).toContain("at 0xabc::user::guard @14");
    expect(out).toContain("at <unknown>::<unknown>"); // null module/function/offset
    expect(out).not.toContain("@null"); // null offset omitted, not printed
  });

  it("forces the full tree on abort even at level 3 (native frame visible)", () => {
    const out = text(formatTraceLines(aborted, 3, 2));
    expect(out).toContain("0x1::vector::borrow");
  });
});
