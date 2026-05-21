import { resolve, extname, dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { runCli } from "../utils/runCli.js";
import { logger } from "../ui/index.js";
import type { RunResult } from "../utils/childProcessAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve the tsx CLI entrypoint (`<tsx-pkg>/dist/cli.mjs`) used by
 * `movehat run` to execute user scripts. Prefers movehat's bundled tsx
 * by default; falls back to the cwd's tsx only if bundled is missing
 * (defensive — should not happen for normal installs). Set
 * `MOVEHAT_TSX_FROM_CWD=1` or pass `preferCwd: true` to flip the
 * order — power-users who pinned a different tsx in their project.
 *
 * Security: the default order closes #52 (untrusted cwd could ship a
 * malicious `node_modules/tsx/dist/cli.mjs`).
 *
 * Exported so the resolution logic can be unit-tested without
 * spawning a real process.
 */
export function resolveTsxCliPath(opts?: { preferCwd?: boolean }): string | null {
  const preferCwd =
    opts?.preferCwd ?? process.env.MOVEHAT_TSX_FROM_CWD === "1";
  const bundledRoot = __dirname;
  const cwdRoot = process.cwd();
  const lookupOrder = preferCwd
    ? [cwdRoot, bundledRoot]
    : [bundledRoot, cwdRoot];

  for (const root of lookupOrder) {
    try {
      const tsxEntry = requireFromHere.resolve("tsx", { paths: [root] });
      // require.resolve("tsx") returns .../tsx/dist/loader.mjs; walk up
      // to the package root and into dist/cli.mjs.
      const packageRoot = dirname(dirname(tsxEntry));
      const cliPath = join(packageRoot, "dist", "cli.mjs");
      if (existsSync(cliPath)) return cliPath;
    } catch {
      // Lookup failed at this root; try the next one.
    }
  }
  return null;
}

/**
 * Apply the exit policy for a child whose output was inherited by the
 * parent. When the child dies via signal, re-raise it on the parent so
 * shells and wrappers see the standard 128+N exit convention. Otherwise
 * forward the numeric exit code, clamping any unexpected -1 to 1 (a -1
 * would mask to 255 on Unix and drop signal-context).
 *
 * Exported so the branch is testable in isolation (a unit test against
 * the full runCommand requires mocking fs + tsx resolution + runCli, all
 * for 4 lines of policy).
 *
 * @internal
 */
export function propagateRunResultExit(result: RunResult): void {
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.exitCode >= 0 ? result.exitCode : 1);
}

export default async function runCommand(scriptPath: string) {
  if (!scriptPath) {
    logger.error("No script path provided");
    logger.plain("Usage: movehat run <script-path> [--network <name>]");
    logger.plain("Example: movehat run scripts/deploy-counter.ts --network testnet");
    process.exit(1);
  }

  const fullPath = resolve(process.cwd(), scriptPath);

  // Check if file exists
  if (!existsSync(fullPath)) {
    logger.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  // Check if it's a TypeScript or JavaScript file
  const ext = extname(fullPath);
  if (![".ts", ".js", ".mjs"].includes(ext)) {
    logger.error(`Unsupported file type: ${ext}`);
    logger.plain("Supported extensions: .ts, .js, .mjs");
    process.exit(1);
  }

  const network = process.env.MH_CLI_NETWORK;
  logger.step(`Running script: ${scriptPath}`);
  if (network) {
    logger.plain(`   Network: ${network}`);
  }
  logger.newline();

  // Find tsx binary — bundled-first per #52 (supply-chain hardening).
  // Cwd resolution stays available behind an opt-in env var for users
  // who pinned a different tsx in their project.
  if (process.env.MOVEHAT_TSX_FROM_CWD === "1") {
    logger.warning(
      "MOVEHAT_TSX_FROM_CWD=1: resolving tsx from cwd first. " +
        "Only use this in trusted project directories."
    );
  }
  const tsxPath = resolveTsxCliPath();

  if (!tsxPath) {
    logger.error("tsx binary not found");
    logger.plain("   Make sure 'tsx' is installed in your project:");
    logger.plain("   npm install --save-dev tsx");
    process.exit(1);
  }

  // Execute script with tsx (handles both .ts and .js files)
  // Using 'node' to execute tsx for cross-platform compatibility.
  try {
    const result = await runCli(
      {
        command: "node",
        args: [tsxPath, fullPath],
        env: {
          ...process.env,
          // MH_CLI_NETWORK is already set by the CLI hook
        },
        inheritStdio: true,
      },
      { throwOnNonZeroExit: false }
    );

    propagateRunResultExit(result);
  } catch (error) {
    logger.error(`Failed to execute script: ${(error as Error).message}`);
    process.exit(1);
  }
}
