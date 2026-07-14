import { existsSync } from "fs";
import { resolve } from "path";
import { loadUserConfig } from "../core/config.js";
import { runCli } from "../utils/runCli.js";
import { logger } from "../ui/index.js";

interface RunMoveTestsOptions {
  filter?: string | undefined;
  ignoreWarnings?: boolean | undefined;
  skipIfMissing?: boolean | undefined; // If true, skip gracefully when Move dir missing (for orchestrated tests)
}

/**
 * Run Move unit tests using Movement CLI
 * @param options Test options including filter, warnings, and skip behavior
 * @returns Promise that resolves when tests complete successfully
 */
export async function runMoveTests(options: RunMoveTestsOptions = {}): Promise<void> {
  const userConfig = await loadUserConfig();
  const moveDir = resolve(process.cwd(), userConfig.moveDir || "./move");

  if (!existsSync(moveDir)) {
    if (options.skipIfMissing) {
      logger.info("No Move directory found (./move not found)");
      logger.plain("   Skipping Move tests...");
      logger.newline();
      return;
    } else {
      throw new Error(
        `Move directory not found: ${moveDir}\n` +
        `   Update movehat.config.ts -> moveDir`
      );
    }
  }

  const args = ["move", "test", "--package-dir", moveDir];

  // Add dev flag for auto-detected addresses
  args.push("--dev");

  if (options.filter) {
    args.push("--filter", options.filter);
  }

  if (options.ignoreWarnings) {
    args.push("--ignore-compile-warnings");
  }

  let result;
  try {
    result = await runCli(
      {
        command: "movement",
        args,
        cwd: process.cwd(),
        inheritStdio: true,
      },
      { throwOnNonZeroExit: false }
    );
  } catch (error) {
    // Spawn-time failure (ENOENT, etc.). The original code logged a
    // Movement-CLI-install hint here; keep that.
    logger.error(`Failed to run Move tests: ${(error as Error).message}`);
    logger.error("   Make sure Movement CLI is installed");
    throw error;
  }

  if (result.exitCode === 0) {
    logger.newline();
    logger.success("Move tests passed");
    return;
  }

  const termination = result.signal
    ? `terminated by ${result.signal}`
    : `exited with code ${result.exitCode}`;
  throw new Error(
    `movement move test ${termination}. The compiler output was streamed above.`,
  );
}
