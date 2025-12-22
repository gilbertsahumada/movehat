import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadUserConfig } from "../core/config.js";

interface RunMoveTestsOptions {
  filter?: string;
  ignoreWarnings?: boolean;
  skipIfMissing?: boolean; // If true, skip gracefully when Move dir missing (for orchestrated tests)
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
      console.log("⊘ No Move directory found (./move not found)");
      console.log("   Skipping Move tests...\n");
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

  return new Promise<void>((resolve, reject) => {
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
  });
}
