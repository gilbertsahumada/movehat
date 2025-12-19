import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { loadUserConfig } from "../core/config.js";
import path from "path";

interface TestOptions {
  moveOnly?: boolean;
  tsOnly?: boolean;
  watch?: boolean;
  filter?: string;
}

export default async function testCommand(options: TestOptions = {}) {
  // Handle move-only flag
  if (options.moveOnly) {
    return runMoveTestsSync(options.filter);
  }

  // Handle ts-only flag (current behavior)
  if (options.tsOnly) {
    return runTypeScriptTests(options.watch);
  }

  // Default: Run both Move and TypeScript tests
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

  // Then run TypeScript tests
  return runTypeScriptTests(false);
}

function runMoveTestsSync(filter?: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    console.log("1. Move Unit Tests");
    console.log("-" + "-".repeat(60) + "\n");

    try {
      const userConfig = await loadUserConfig();
      const moveDir = path.resolve(process.cwd(), userConfig.moveDir || "./move");

      if (!existsSync(moveDir)) {
        console.log("⊘ No Move directory found (./move not found)");
        console.log("   Skipping Move tests...\n");
        resolve();
        return;
      }

      const args = ["move", "test", "--package-dir", moveDir];

      if (filter) {
        args.push("--filter", filter);
      }

      const child = spawn("movement", args, {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      child.on("exit", (code) => {
        if (code === 0) {
          console.log("\n✓ Move tests passed");
          resolve();
        } else {
          reject(new Error("Move tests failed"));
        }
      });

      child.on("error", (error) => {
        console.error(`Failed to run Move tests: ${error.message}`);
        console.error("   Make sure Movement CLI is installed");
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
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

    child.on("exit", (code) => {
      if (code === 0) {
        console.log("\n✓ TypeScript tests passed");
        console.log("\n" + "=" + "=".repeat(60));
        console.log("\n✓ All tests passed!\n");
        resolve();
      } else {
        console.error("\n✗ TypeScript tests failed");
        console.log("\n" + "=" + "=".repeat(60));
        process.exit(code || 1);
      }
    });

    child.on("error", (error) => {
      console.error(`Failed to run TypeScript tests: ${error.message}`);
      reject(error);
    });
  });
}
