import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadUserConfig } from "../core/config.js";
import { validatePathSafety } from "../core/shell.js";
import { logger } from "../ui/index.js";
import { runCli, runCliUntilInterrupted } from "../utils/runCli.js";

const DEFAULT_MOVE_TOOL_TIMEOUT_MS = 5 * 60 * 1000;

export async function resolveMovePackageDir(): Promise<string> {
  const config = await loadUserConfig();
  const packageDir = resolve(process.cwd(), config.moveDir || "./move");
  if (!existsSync(packageDir)) {
    throw new Error(`Move directory not found: ${packageDir}`);
  }
  return validatePathSafety(packageDir, "Move directory");
}

export interface RunMovementMoveCommandOptions {
  /** `Infinity` disables the timer for intentionally long-running tools. */
  timeoutMs?: number;
}

export async function runMovementMoveCommand(
  verb: string,
  extraArgs: readonly string[] = [],
  verbArgs: readonly string[] = [],
  options: RunMovementMoveCommandOptions = {}
): Promise<void> {
  const packageDir = await resolveMovePackageDir();
  const timeoutMs = options.timeoutMs ?? DEFAULT_MOVE_TOOL_TIMEOUT_MS;
  const input = {
    command: "movement",
    args: ["move", verb, ...verbArgs, "--package-dir", packageDir, ...extraArgs],
    cwd: process.cwd(),
    inheritStdio: true,
    timeoutMs,
  } as const;
  const result = await (timeoutMs === Infinity
    ? runCliUntilInterrupted(input, { throwOnNonZeroExit: false })
    : runCli(input, { throwOnNonZeroExit: false }));

  // Long-running tools are attached to the terminal. A parent interrupt is
  // an expected user action; runCliUntilInterrupted already recorded 130/143.
  if (timeoutMs === Infinity && result.interruptedByParent) return;
  if (result.signal) {
    throw new Error(`movement move ${verb} terminated by ${result.signal}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`movement move ${verb} exited with code ${result.exitCode}`);
  }
  logger.success(`Move ${verb} finished successfully`);
}
