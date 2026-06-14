import { logger } from "../../ui/index.js";
import { colors } from "../../ui/colors.js";
import { symbols } from "../../ui/symbols.js";

import {
  brightBlue,
  formatEventLine,
  formatValue,
  indent,
  shortenPath,
  storageLine,
} from "./format.js";

import type {
  AbortInfo,
  CallNode,
  TracedArg,
  TracedEvent,
  TraceResponse,
} from "./types.js";

const isFramework = (module: string | null): boolean =>
  module !== null && module.startsWith("0x1::");

/** Visible at level 3 (user-module tree): not a framework frame, not a native. */
const isUserFrame = (node: CallNode): boolean =>
  !isFramework(node.module) && node.kind !== "native";

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
    for (const e of node.events) lines.push(indent(childDepth) + formatEventLine(e));
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
    lines.push(indent(childDepth) + formatEventLine(e));
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
      for (const { event } of events) lines.push("  " + formatEventLine(event));
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
