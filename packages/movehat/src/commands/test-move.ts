import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { loadUserConfig } from "../core/config.js";

interface TestMoveOptions {
  filter?: string;
  ignoreWarnings?: boolean;
}

export default async function testMoveCommand(options: TestMoveOptions = {}) {
  try {
    const userConfig = await loadUserConfig();
    const moveDir = path.resolve(process.cwd(), userConfig.moveDir || "./move");

    if (!fs.existsSync(moveDir)) {
      console.error(`Move directory not found: ${moveDir}`);
      console.error(`   Update movehat.config.ts -> moveDir`);
      process.exit(1);
    }

    console.log("Running Move unit tests...\n");

    const args = ["move", "test", "--package-dir", moveDir];

    // Add filter if provided
    if (options.filter) {
      args.push("--filter", options.filter);
    }

    // Add ignore-warnings flag if provided
    if (options.ignoreWarnings) {
      args.push("--ignore-compile-warnings");
    }

    // Spawn movement CLI
    const child = spawn("movement", args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log("\n✓ Move tests passed");
      } else {
        console.error("\n✗ Move tests failed");
      }
      process.exit(code || 0);
    });

    child.on("error", (error) => {
      console.error(`Failed to run Move tests: ${error.message}`);
      console.error("   Make sure Movement CLI is installed");
      console.error("   Run: movement --version");
      process.exit(1);
    });
  } catch (err: any) {
    console.error("Move tests failed:", err.message ?? err);
    process.exit(1);
  }
}
