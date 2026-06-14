import { describe, expect, it } from "vitest";

import { formatNodeTraceLines } from "../nodeRenderer.js";
import type { NodeTxView } from "../nodeRenderer.js";

const text = (lines: string[]) => lines.join("\n");

const longAddr =
  "0xfd1c28091511e9285586fa38de58a35fc4f2388724ffbef57b0467cce2882c54";

const success: NodeTxView = {
  success: true,
  vm_status: "Executed successfully",
  gas_used: "440",
  events: [{ type: `${longAddr}::counter::Incremented`, data: { value: "1" } }],
  changes: [
    {
      type: "write_resource",
      address: longAddr,
      data: { type: `${longAddr}::counter::Counter`, data: { count: "99" } },
    },
    { type: "delete_resource", address: longAddr, resource: "0x1::old::Thing" },
    { type: "write_table_item", handle: longAddr },
    { type: "write_module", address: longAddr },
    { type: "delete_table_item", handle: longAddr },
    { type: "delete_module", address: longAddr },
  ],
};

describe("formatNodeTraceLines — node degraded trace", () => {
  it("level 2: events + footer, no state changes", () => {
    const out = text(formatNodeTraceLines(success, 2));
    expect(out).toContain("Events");
    expect(out).toMatch(/emit .*::counter::Incremented/);
    expect(out).toContain("Executed successfully");
    expect(out).toContain("gas_used: 440 octas");
    // State changes appear only from level 3.
    expect(out).not.toContain("State changes");
  });

  it("level 3: adds the write-set summary, no raw data payload", () => {
    const out = text(formatNodeTraceLines(success, 3));
    expect(out).toContain("State changes");
    expect(out).toContain("delete_resource");
    // Long resource type/address is shortened.
    expect(out).toMatch(/write_resource 0xfd1c\.\.2c54::counter::Counter/);
    // Table items key off the shortened table handle, not a resource type.
    expect(out).toMatch(/write_table_item table_item @0xfd1c\.\.2c54/);
    // Module changes render with a generic "module" type.
    expect(out).toMatch(/write_module module/);
    // delete_* variants fall through to the same handling as their write_
    // counterparts: table items still key off the handle, modules stay generic.
    expect(out).toMatch(/delete_table_item table_item @0xfd1c\.\.2c54/);
    expect(out).toMatch(/delete_module module/);
    // Raw resource data is withheld until level 4.
    expect(out).not.toContain('"count":"99"');
  });

  it("level 4: appends each change's decoded data payload", () => {
    const out = text(formatNodeTraceLines(success, 4));
    expect(out).toContain('{"count":"99"}');
  });

  it("renders an abort: failed status carries the vm_status reason", () => {
    const aborted: NodeTxView = {
      success: false,
      vm_status: "Move abort in 0x1::account: ERESOURCE_ALREADY_EXISTS",
      gas_used: "4",
      events: [],
      changes: [],
    };
    const out = text(formatNodeTraceLines(aborted, 2));
    expect(out).toContain("(no events emitted)");
    expect(out).toContain("Move abort in 0x1::account");
    expect(out).toContain("gas_used: 4 octas");
  });

  it("shows a placeholder when there are no events", () => {
    const noEvents: NodeTxView = { ...success, events: [] };
    expect(text(formatNodeTraceLines(noEvents, 2))).toContain(
      "(no events emitted)"
    );
  });

  it("never emits raw ANSI escape codes (color is gated)", () => {
    for (const lvl of [2, 3, 4]) {
      expect(text(formatNodeTraceLines(success, lvl))).not.toContain("\x1b[");
    }
  });
});
