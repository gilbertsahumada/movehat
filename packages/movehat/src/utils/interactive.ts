/**
 * Whether the current session should behave interactively. An explicit
 * override (the commands' documented `interactive` test hook) wins;
 * otherwise both stdio ends must be TTYs.
 */
export function isInteractiveSession(explicit?: boolean): boolean {
  return explicit ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
