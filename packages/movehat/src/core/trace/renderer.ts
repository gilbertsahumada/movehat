import { logger } from "../../ui/index.js";
import { colors, rgbToAnsi, shouldUseColor } from "../../ui/colors.js";
import { symbols } from "../../ui/symbols.js";

import type {
  AbortInfo,
  CallNode,
  TracedArg,
  TracedEvent,
  TraceResponse,
} from "./types.js";

// rgbToAnsi emits raw escapes unconditionally, so guard these two ourselves
// (unlike colors.*, which already no-op when color is disabled).
const orange = (s: string): string =>
  shouldUseColor() ? `${rgbToAnsi(255, 165, 0)}${s}\x1b[0m` : s;
const brightBlue = (s: string): string =>
  shouldUseColor() ? `${rgbToAnsi(90, 170, 255)}${s}\x1b[0m` : s;

const indent = (depth: number): string => "  ".repeat(depth);

/** Shorten a 0x-prefixed address for display (`0xf903..9b16`); leave short
 *  framework addresses like `0x1` untouched. */
const shortAddr = (addr: string): string =>
  addr.startsWith("0x") && addr.length > 12
    ? `${addr.slice(0, 6)}..${addr.slice(-4)}`
    : addr;

/** Shorten the address part of a `address::module[::Name]` path. */
const shortenPath = (path: string): string => {
  const [addr, ...rest] = path.split("::");
  if (addr === undefined || rest.length === 0) return path;
  return [shortAddr(addr), ...rest].join("::");
};

const isFramework = (module: string | null): boolean =>
  module !== null && module.startsWith("0x1::");

/** Visible at level 3 (user-module tree): not a framework frame, not a native. */
const isUserFrame = (node: CallNode): boolean =>
  !isFramework(node.module) && node.kind !== "native";

const NUMERIC = /^\d+$/;

const leafValue = (value: unknown): string => {
  const s = String(value);
  if (NUMERIC.test(s)) return orange(s);
  if (s.startsWith("0x") && s.length > 12) return shortAddr(s);
  return s;
};

/** Format a decoded value. Struct (and vector) values arrive as objects with
 *  by-index keys; their fields can themselves be structs, so recurse rather
 *  than `String()`-ing a nested object into `[object Object]`. */
const formatValue = (value: unknown): string => {
  if (value !== null && typeof value === "object") {
    return `{ ${Object.values(value as Record<string, unknown>)
      .map(formatValue)
      .join(", ")} }`;
  }
  return leafValue(value);
};

const formatArgValue = (arg: TracedArg): string => {
  if (arg.value === null) return "()";
  return formatValue(arg.value);
};

const formatArgs = (args: TracedArg[]): string =>
  args.map(formatArgValue).join(", ");

const frameName = (node: CallNode): string => {
  const base = node.module
    ? `${shortenPath(node.module)}::${node.function ?? "?"}`
    : node.function ?? `<${node.kind}>`;
  return base;
};

const frameLabel = (node: CallNode): string => {
  const name = frameName(node);
  const colored =
    isFramework(node.module) || node.kind === "native"
      ? colors.dim(name)
      : colors.bold(colors.info(name));
  const gas = colors.dim(` [${node.gas}]`);
  return `${colored}(${formatArgs(node.args)})${gas}`;
};

const formatData = (data: unknown): string => {
  if (data === null || data === undefined) return "";
  try {
    return colors.dim(JSON.stringify(data));
  } catch {
    return colors.dim(String(data));
  }
};

const eventLine = (event: TracedEvent): string =>
  `${colors.warning(`emit ${shortenPath(event.type)}`)} ${formatData(event.data)}`.trimEnd();

const storageLine = (op: { op: string; type: string; address: string | null }): string =>
  `${colors.primary(`${op.op} ${shortenPath(op.type)}`)}${
    op.address ? colors.dim(` @${shortAddr(op.address)}`) : ""
  }`;

/** Non-unit return values only; null when nothing to show. */
const returnLine = (ret: TracedArg[]): string | null => {
  const meaningful = ret.filter((r) => r.type !== "()" && r.value !== null);
  if (meaningful.length === 0) return null;
  return colors.success(`← ${meaningful.map(formatArgValue).join(", ")}`);
};

/** Collect every event in the tree with its emitting module — for the flat
 *  level-2 view. */
const collectEvents = (
  node: CallNode,
  out: { module: string | null; event: TracedEvent }[]
): void => {
  for (const e of node.events) out.push({ module: node.module, event: e });
  for (const c of node.children) collectEvents(c, out);
};

/** Level 3: descend through hidden (framework / native) frames, bubbling their
 *  events up and surfacing the nearest visible frames as children. */
const gatherHidden = (
  children: CallNode[],
  bubbled: TracedEvent[],
  visible: CallNode[]
): void => {
  for (const child of children) {
    if (isUserFrame(child)) {
      visible.push(child);
    } else {
      bubbled.push(...child.events);
      gatherHidden(child.children, bubbled, visible);
    }
  }
};

const renderNode = (
  node: CallNode,
  depth: number,
  showFull: boolean,
  lines: string[]
): void => {
  lines.push(indent(depth) + frameLabel(node));
  const childDepth = depth + 1;

  if (showFull) {
    for (const e of node.events) lines.push(indent(childDepth) + eventLine(e));
    for (const s of node.storage) lines.push(indent(childDepth) + storageLine(s));
    const ret = returnLine(node.return);
    if (ret) lines.push(indent(childDepth) + ret);
    for (const c of node.children) renderNode(c, childDepth, showFull, lines);
    return;
  }

  // Level 3: own events + events bubbled from hidden descendants, then the
  // nearest visible child frames.
  const bubbled: TracedEvent[] = [];
  const visibleChildren: CallNode[] = [];
  gatherHidden(node.children, bubbled, visibleChildren);
  for (const e of [...node.events, ...bubbled]) {
    lines.push(indent(childDepth) + eventLine(e));
  }
  for (const c of visibleChildren) renderNode(c, childDepth, showFull, lines);
};

const formatAbort = (abort: AbortInfo): string[] => {
  const lines: string[] = [];
  let header = colors.error(`${symbols.error} Aborted: code ${abort.code}`);
  if (abort.sub_status !== null) {
    header += colors.error(` (sub_status ${abort.sub_status})`);
  }
  if (abort.module !== null) {
    header += colors.dim(` in ${shortenPath(abort.module)}`);
  }
  lines.push(header);
  for (const entry of abort.stack) {
    const mod = entry.module !== null ? shortenPath(entry.module) : "<unknown>";
    const fn = entry.function ?? "<unknown>";
    const off = entry.offset !== null ? ` @${entry.offset}` : "";
    lines.push("  " + colors.error(`at ${mod}::${fn}${off}`));
  }
  return lines;
};

const formatFooter = (response: TraceResponse, elapsedMs: number): string => {
  const status = response.success
    ? colors.success(`${symbols.success} Executed successfully`)
    : colors.error(`${symbols.error} Aborted`);
  const sep = colors.dim(" · ");
  const gas = colors.dim(`gas_used: ${response.gas_used} octas`);
  const timed = brightBlue(`traced in ${Math.round(elapsedMs)}ms`);
  return `${status}${sep}${gas}${sep}${timed}`;
};

/**
 * Pure formatter — turns a trace into display lines. Snapshot-testable without
 * touching stdout. `level` is the verbosity level (2..4); per-frame `gas` is in
 * internal VM units while the footer `gas_used` is in octas (never mixed).
 */
export function formatTraceLines(
  response: TraceResponse,
  level: number,
  elapsedMs: number
): string[] {
  const lines: string[] = [];

  if (level <= 2) {
    const events: { module: string | null; event: TracedEvent }[] = [];
    collectEvents(response.root, events);
    if (events.length === 0) {
      lines.push(colors.dim("(no events emitted)"));
    } else {
      lines.push(colors.bold("Events"));
      for (const { event } of events) lines.push("  " + eventLine(event));
    }
  } else {
    // Aborts always show the full tree so the failing frame is visible.
    const showFull = level >= 4 || !response.success;
    lines.push(colors.bold("Trace"));
    renderNode(response.root, 0, showFull, lines);
  }

  if (!response.success && response.abort) {
    lines.push("");
    lines.push(...formatAbort(response.abort));
  }

  lines.push("");
  lines.push(formatFooter(response, elapsedMs));
  return lines;
}

/** Render a trace to the terminal. Wraps {@link formatTraceLines}. */
export function renderTrace(
  response: TraceResponse,
  opts: { level: number; elapsedMs: number }
): void {
  logger.newline();
  for (const line of formatTraceLines(response, opts.level, opts.elapsedMs)) {
    logger.plain(line);
  }
  logger.newline();
}
