import { logger } from "../../ui/index.js";
import { colors } from "../../ui/colors.js";
import { symbols } from "../../ui/symbols.js";

import { formatData, formatEventLine, storageLine } from "./format.js";

/**
 * Minimal structural view of a committed transaction, as the Aptos SDK's
 * `waitForTransaction` returns it (`UserTransactionResponse`). Typed loosely so
 * unit tests can feed plain fixtures and so we never depend on the full SDK
 * response union. The real Movement node REST API does NOT expose internal call
 * frames, so this is a flat, degraded trace — events + write-set + gas — rather
 * than the movelite call tree.
 */
export interface NodeTxView {
  success: boolean;
  vm_status: string;
  /** Transaction gas in octas (external unit). */
  gas_used: string;
  events: { type: string; data: unknown }[];
  changes: NodeWriteSetChange[];
}

/** Loose shape of an SDK `WriteSetChange` — only the fields we render. */
interface NodeWriteSetChange {
  type: string;
  address?: string;
  /** `write_resource` / `write_module` payload (a `MoveResource` `{type,data}`). */
  data?: { type?: string; data?: unknown } | unknown;
  /** `delete_resource` carries the resource type as a string here. */
  resource?: string;
}

/** Reshape an SDK write-set change into the shared `storageLine` duck-type. */
const changeToOp = (
  c: NodeWriteSetChange
): { op: string; type: string; address: string | null } => {
  const address = typeof c.address === "string" ? c.address : null;
  switch (c.type) {
    case "write_resource": {
      const t =
        c.data && typeof c.data === "object" && "type" in c.data
          ? String((c.data as { type?: unknown }).type ?? "?")
          : "?";
      return { op: c.type, type: t, address };
    }
    case "delete_resource":
      return { op: c.type, type: c.resource ?? "?", address };
    case "write_module":
    case "delete_module":
      return { op: c.type, type: "module", address };
    case "write_table_item":
    case "delete_table_item":
      return { op: c.type, type: "table_item", address: null };
    default:
      return { op: c.type, type: "?", address };
  }
};

/** Level-4 payload for a change: the resource's decoded fields when present. */
const changePayload = (c: NodeWriteSetChange): unknown => {
  if (c.data && typeof c.data === "object" && "data" in c.data) {
    return (c.data as { data?: unknown }).data;
  }
  return c.data;
};

const nodeFooter = (tx: NodeTxView): string => {
  const status = tx.success
    ? colors.success(`${symbols.success} ${tx.vm_status}`)
    : colors.error(`${symbols.error} ${tx.vm_status}`);
  const sep = colors.dim(" · ");
  const gas = colors.dim(`gas_used: ${tx.gas_used} octas`);
  return `${status}${sep}${gas}`;
};

/**
 * Pure formatter for the node degraded trace. Snapshot-testable without
 * touching stdout. `level` is the verbosity level (2..4): L2 = events, L3 =
 * + state changes, L4 = + each change's decoded data. The footer carries the
 * status and the octa `gas_used` (there is no per-frame trace timing off the
 * node).
 */
export function formatNodeTraceLines(tx: NodeTxView, level: number): string[] {
  const lines: string[] = [];

  // Events (level 2+).
  if (tx.events.length === 0) {
    lines.push(colors.dim("(no events emitted)"));
  } else {
    lines.push(colors.bold("Events"));
    for (const e of tx.events) lines.push("  " + formatEventLine(e));
  }

  // State changes (level 3+).
  if (level >= 3) {
    lines.push("");
    if (tx.changes.length === 0) {
      lines.push(colors.dim("(no state changes)"));
    } else {
      lines.push(colors.bold("State changes"));
      for (const c of tx.changes) {
        lines.push("  " + storageLine(changeToOp(c)));
        if (level >= 4) {
          const payload = formatData(changePayload(c));
          if (payload) lines.push("    " + payload);
        }
      }
    }
  }

  lines.push("");
  lines.push(nodeFooter(tx));
  return lines;
}

/** Render a node degraded trace to the terminal. Wraps {@link formatNodeTraceLines}. */
export function renderNodeTrace(tx: NodeTxView, opts: { level: number }): void {
  logger.newline();
  for (const line of formatNodeTraceLines(tx, opts.level)) {
    logger.plain(line);
  }
  logger.newline();
}
