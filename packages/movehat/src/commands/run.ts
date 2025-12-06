import { spawn } from "child_process";
import { resolve, extname, dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

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

  // Find tsx from movehat's node_modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const tsxPath = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");

  // Execute script with tsx (handles both .ts and .js files)
  const child = spawn(tsxPath, [fullPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      // MH_CLI_NETWORK is already set by the CLI hook
    },
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });

  child.on("error", (error) => {
    console.error(`❌ Failed to execute script: ${error.message}`);
    process.exit(1);
  });
}
