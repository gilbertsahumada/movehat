import { spawn } from "child_process";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { runMoveTests } from "../helpers/move-tests.js";

interface TestOptions {
  moveOnly?: boolean;
  tsOnly?: boolean;
  watch?: boolean;
  filter?: string;
}

export default async function testCommand(options: TestOptions = {}) {
  // Handle move-only flag
  if (options.moveOnly) {
    if (options.watch) {
      console.error("ERROR: --watch flag is not supported with --move-only");
      console.error("       Watch mode only works with TypeScript tests");
      process.exit(1);
    }
    return runMoveTestsSync(options.filter);
  }

  // Handle ts-only flag or watch flag (watch implies ts-only)
  if (options.tsOnly || options.watch) {
    return runTypeScriptTests(options.watch);
  }

  // Default: Run both Move and TypeScript tests (no watch mode)
  console.log("Running all tests...\n");
  console.log("=" + "=".repeat(60) + "\n");

  // First run Move tests (fail fast)
  try {
    await runMoveTestsSync();
    console.log("\n" + "=" + "=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n✗ Move tests failed");
    console.log("\n" + "=" + "=".repeat(60));
    process.exit(1);
  }

  // Then run TypeScript tests (never in watch mode for "all tests")
  try {
    await runTypeScriptTests(false);
    console.log("\n" + "=" + "=".repeat(60));
    console.log("\n✓ All tests passed!\n");
  } catch (error) {
    console.error("\n" + "=" + "=".repeat(60));
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${message}\n`);
    process.exit(1);
  }
}

async function runMoveTestsSync(filter?: string): Promise<void> {
  console.log("1. Move Unit Tests");
  console.log("-" + "-".repeat(60) + "\n");

  return runMoveTests({
    filter,
    skipIfMissing: true, // Gracefully skip if no Move directory (orchestrated test mode)
  });
}

function runTypeScriptTests(watch: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("2. TypeScript Integration Tests");
    console.log("-" + "-".repeat(60) + "\n");

    const testDir = join(process.cwd(), "tests");

    if (!existsSync(testDir)) {
      console.log("⊘ No TypeScript tests found (tests directory not found)");
      console.log("   Skipping TypeScript tests...\n");
      resolve();
      return;
    }

    const mochaPath = join(process.cwd(), "node_modules", ".bin", "mocha");

    if (!existsSync(mochaPath)) {
      console.error("✗ Mocha not found in project dependencies.");
      console.error("   Install it with: npm install --save-dev mocha");
      reject(new Error("Mocha not found"));
      return;
    }

    const args = watch ? ["--watch"] : [];

    const child = spawn(mochaPath, args, {
      stdio: "inherit",
      env: {
        ...process.env,
      },
    });

    // In watch mode, Mocha never exits, so resolve immediately
    if (watch) {
      console.log("Watch mode active. Press Ctrl+C to exit.\n");
      resolve();
      return;
    }

    // Non-watch mode: wait for exit
    child.on("exit", (code) => {
      if (code === 0) {
        console.log("\n✓ TypeScript tests passed");
        resolve();
      } else {
        const exitCode = typeof code === "number" ? code : 1;
        reject(new Error(`TypeScript tests failed with exit code ${exitCode}`));
      }
    });

    child.on("error", (error) => {
      console.error(`Failed to run TypeScript tests: ${error.message}`);
      reject(error);
    });
  });
}
