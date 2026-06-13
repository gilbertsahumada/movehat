import { colors, rgbToAnsi, shouldUseColor } from "../../ui/colors.js";

// Generic, stateless formatting helpers shared by the movelite call-tree
// renderer (renderer.ts) and the node degraded-trace renderer (nodeRenderer.ts).
// None of these are tied to a specific response shape.

// rgbToAnsi emits raw escapes unconditionally, so guard these two ourselves
// (unlike colors.*, which already no-op when color is disabled).
export const orange = (s: string): string =>
  shouldUseColor() ? `${rgbToAnsi(255, 165, 0)}${s}\x1b[0m` : s;
export const brightBlue = (s: string): string =>
  shouldUseColor() ? `${rgbToAnsi(90, 170, 255)}${s}\x1b[0m` : s;

export const indent = (depth: number): string => "  ".repeat(depth);

/** Shorten a 0x-prefixed address for display (`0xf903..9b16`); leave short
 *  framework addresses like `0x1` untouched. */
export const shortAddr = (addr: string): string =>
  addr.startsWith("0x") && addr.length > 12
    ? `${addr.slice(0, 6)}..${addr.slice(-4)}`
    : addr;

/** Shorten the address part of a `address::module[::Name]` path. */
export const shortenPath = (path: string): string => {
  const [addr, ...rest] = path.split("::");
  if (addr === undefined || rest.length === 0) return path;
  return [shortAddr(addr), ...rest].join("::");
};

const NUMERIC = /^\d+$/;

export const leafValue = (value: unknown): string => {
  const s = String(value);
  if (NUMERIC.test(s)) return orange(s);
  if (s.startsWith("0x") && s.length > 12) return shortAddr(s);
  return s;
};

/** Format a decoded value. Struct (and vector) values arrive as objects with
 *  by-index keys; their fields can themselves be structs, so recurse rather
 *  than `String()`-ing a nested object into `[object Object]`. */
export const formatValue = (value: unknown): string => {
  if (value !== null && typeof value === "object") {
    return `{ ${Object.values(value as Record<string, unknown>)
      .map(formatValue)
      .join(", ")} }`;
  }
  return leafValue(value);
};

export const formatData = (data: unknown): string => {
  if (data === null || data === undefined) return "";
  try {
    return colors.dim(JSON.stringify(data));
  } catch {
    return colors.dim(String(data));
  }
};

/** One emitted-event line: `emit <module>::<Event> {…data}`. Reads only `type`
 *  and `data`, so it accepts both the movelite `TracedEvent` and the SDK's
 *  `Event` shape. */
export const formatEventLine = (event: { type: string; data: unknown }): string =>
  `${colors.warning(`emit ${shortenPath(event.type)}`)} ${formatData(event.data)}`.trimEnd();

/** One storage / state-change line: `<op> <module>::<Resource> [@addr]`. The
 *  `op` object is duck-typed so both movelite storage ops and SDK write-set
 *  changes (after reshaping) feed it. */
export const storageLine = (op: {
  op: string;
  type: string;
  address: string | null;
}): string =>
  `${colors.primary(`${op.op} ${shortenPath(op.type)}`)}${
    op.address ? colors.dim(` @${shortAddr(op.address)}`) : ""
  }`;
