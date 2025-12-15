import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { loadUserConfig } from "../core/config.js";
import { validateAndEscapePath, escapeShellArg } from "../core/shell.js";

/**
 * Recursively find all .move files in a directory
 */
function findMoveFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMoveFiles(fullPath));
    } else if (entry.name.endsWith('.move')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract named addresses used in Move files
 * Looks for patterns like: module <address>::<module_name>
 */
function extractNamedAddresses(moveDir: string): Set<string> {
  const addresses = new Set<string>();
  const moveFiles = findMoveFiles(moveDir);

  for (const file of moveFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    // Match: module <address>::<module_name>
    const moduleRegex = /module\s+([a-zA-Z_][a-zA-Z0-9_]*)::/g;
    let match;

    while ((match = moduleRegex.exec(content)) !== null) {
      const address = match[1];
      // Skip standard addresses
      if (address !== 'std' && address !== 'aptos_framework' && address !== 'aptos_std') {
        addresses.add(address);
      }
    }
  }

  return addresses;
}

function run(command: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export default async function compileCommand() {
  try {
    // Compile is network-independent - only uses global config
    const userConfig = await loadUserConfig();

    console.log("Compiling Move contracts...");

    const moveDir = path.resolve(process.cwd(), userConfig.moveDir || "./move");
    if (!fs.existsSync(moveDir)) {
      console.error(`Move directory not found: ${moveDir}`);
      console.error(`   Update movehat.config.ts -> moveDir`);
      return;
    }

    // Validate and escape to prevent command injection
    const safeMoveDir = validateAndEscapePath(moveDir, "Move directory");

    // Auto-detect named addresses from Move files
    const detectedAddresses = extractNamedAddresses(moveDir);

    // Merge user-configured addresses with auto-detected ones
    const namedAddresses = { ...(userConfig.namedAddresses ?? {}) };

    // For any detected address not in config, use a dev address
    for (const addr of detectedAddresses) {
      if (!namedAddresses[addr]) {
        namedAddresses[addr] = "0xcafe"; // Dev address for compilation
      }
    }

    let namedAddressesArg = "";

    if (Object.keys(namedAddresses).length > 0) {
      // Validate and escape each address name and value
      const escapedAddresses = Object.entries(namedAddresses)
        .map(([k, v]) => {
          // Validate address name (alphanumeric, underscore only)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
            throw new Error(
              `Invalid named address "${k}". ` +
              `Names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
            );
          }

          // Validate address value (should be hex address)
          if (!/^0x[a-fA-F0-9]+$/.test(v)) {
            throw new Error(
              `Invalid address value for "${k}": "${v}". ` +
              `Address values must be hex strings starting with "0x".`
            );
          }

          // No need to escape since we validated the format
          return `${k}=${v}`;
        })
        .join(",");

      namedAddressesArg = `--named-addresses ${escapeShellArg(escapedAddresses)}`;
    }

    const command = `movement move build --package-dir ${safeMoveDir} ${namedAddressesArg}`.trim();

    console.log(`   Move directory: ${moveDir}`);
    if (detectedAddresses.size > 0) {
      console.log(`   Detected addresses: ${Array.from(detectedAddresses).join(", ")}`);
    }
    if (Object.keys(userConfig.namedAddresses ?? {}).length > 0) {
      console.log(`   Configured addresses: ${Object.keys(userConfig.namedAddresses!).join(", ")}`);
    }
    console.log();

    await run(command, moveDir);
    console.log("Compilation finished successfully.");
  } catch (err: any) {
    console.error("Compilation failed:", err.message ?? err);
    process.exit(1);
  }
}
