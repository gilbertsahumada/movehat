import { existsSync } from "fs";
import { resolve } from "path";
import { loadUserConfig } from "../core/config.js";
import { validatePathSafety } from "../core/shell.js";
import { logger } from "../ui/index.js";
import { runCli } from "../utils/runCli.js";

export async function resolveMovePackageDir(): Promise<string> {
  const config = await loadUserConfig();
  const packageDir = resolve(process.cwd(), config.moveDir || "./move");
  if (!existsSync(packageDir)) {
    throw new Error(`Move directory not found: ${packageDir}`);
  }
  return validatePathSafety(packageDir, "Move directory");
}

export async function runMovementMoveCommand(
  verb: string,
  extraArgs: readonly string[] = [],
  verbArgs: readonly string[] = []
): Promise<void> {
  const packageDir = await resolveMovePackageDir();
  const result = await runCli(
    {
      command: "movement",
      args: ["move", verb, ...verbArgs, "--package-dir", packageDir, ...extraArgs],
      cwd: process.cwd(),
      inheritStdio: true,
      timeoutMs: 120000,
    },
    { throwOnNonZeroExit: false }
  );
  if (result.signal) {
    throw new Error(`movement move ${verb} terminated by ${result.signal}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`movement move ${verb} exited with code ${result.exitCode}`);
  }
  logger.success(`Move ${verb} finished successfully`);
}
