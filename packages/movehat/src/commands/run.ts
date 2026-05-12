import { resolve, extname, dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { runCli } from "../utils/runCli.js";

export default async function runCommand(scriptPath: string) {
  if (!scriptPath) {
    console.error("❌ Error: No script path provided");
    console.error("Usage: movehat run <script-path> [--network <name>]");
    console.error("Example: movehat run scripts/deploy-counter.ts --network testnet");
    process.exit(1);
  }

  const fullPath = resolve(process.cwd(), scriptPath);

  // Check if file exists
  if (!existsSync(fullPath)) {
    console.error(`❌ Script not found: ${scriptPath}`);
    process.exit(1);
  }

  // Check if it's a TypeScript or JavaScript file
  const ext = extname(fullPath);
  if (![".ts", ".js", ".mjs"].includes(ext)) {
    console.error(`❌ Unsupported file type: ${ext}`);
    console.error("Supported extensions: .ts, .js, .mjs");
    process.exit(1);
  }

  const network = process.env.MH_CLI_NETWORK;
  console.log(`🚀 Running script: ${scriptPath}`);
  if (network) {
    console.log(`   Network: ${network}`);
  }
  console.log();

  // Find tsx binary - try multiple locations for compatibility
  // Uses require.resolve for cross-platform compatibility (works on Windows, macOS, Linux)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Create require function for ESM (needed to use require.resolve in ESM modules)
  const require = createRequire(import.meta.url);

  let tsxPath: string;
  try {
    // Try to resolve tsx package from user's project first
    const tsxPackagePath = require.resolve("tsx", { paths: [process.cwd()] });
    // require.resolve("tsx") returns .../tsx/dist/loader.mjs
    // We need to go up to the tsx package root, then into dist/cli.mjs
    const tsxPackageRoot = dirname(dirname(tsxPackagePath));
    tsxPath = join(tsxPackageRoot, "dist", "cli.mjs");

    // Verify the file exists
    if (!existsSync(tsxPath)) {
      throw new Error("cli.mjs not found");
    }
  } catch {
    try {
      // Fallback to movehat's own tsx
      const tsxPackagePath = require.resolve("tsx", { paths: [__dirname] });
      const tsxPackageRoot = dirname(dirname(tsxPackagePath));
      tsxPath = join(tsxPackageRoot, "dist", "cli.mjs");

      if (!existsSync(tsxPath)) {
        throw new Error("cli.mjs not found");
      }
    } catch {
      tsxPath = "";
    }
  }

  if (!tsxPath) {
    console.error("❌ Error: tsx binary not found");
    console.error("   Make sure 'tsx' is installed in your project:");
    console.error("   npm install --save-dev tsx");
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

    // When the user's script dies via signal (Ctrl+C, SIGTERM from a
    // wrapper, etc.), runCli returns exitCode:-1 with signal populated.
    // Re-raise the signal on the parent to preserve process-group
    // semantics — shells reading $? see 128+N as expected, and wrappers
    // can distinguish "killed by user" from generic "exit 1". A plain
    // process.exit(-1) would mask to 255 on Unix and drop that context.
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exit(result.exitCode >= 0 ? result.exitCode : 1);
  } catch (error) {
    console.error(`❌ Failed to execute script: ${(error as Error).message}`);
    process.exit(1);
  }
}
