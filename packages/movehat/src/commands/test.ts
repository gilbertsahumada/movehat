import { spawn } from "child_process";
import { join, 
  //dirname
 } from "path";
import { existsSync } from "fs";
//import { fileURLToPath } from "url";

export default async function testCommand() {
  const testDir = join(process.cwd(), "tests");

  if (!existsSync(testDir)) {
    console.error("❌ No tests directory found.");
    console.error("   Create a 'tests' directory with your TypeScript test files.");
    process.exit(1);
  }

  console.log("🧪 Running TypeScript tests with Mocha...\n");

  // Find mocha from project's node_modules
  const mochaPath = join(process.cwd(), "node_modules", ".bin", "mocha");

  if (!existsSync(mochaPath)) {
    console.error("❌ Mocha not found in project dependencies.");
    console.error("   Install it with: npm install --save-dev mocha");
    process.exit(1);
  }

  // Run mocha with TypeScript support
  const child = spawn(mochaPath, [], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Inherit network if set
    },
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });

  child.on("error", (error) => {
    console.error(`❌ Failed to run tests: ${error.message}`);
    process.exit(1);
  });
}