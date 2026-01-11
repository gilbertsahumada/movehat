import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { loadUserConfig } from "../core/config.js";
import { validateAndEscapePath, escapeShellArg } from "../core/shell.js";
import { logger } from "../ui/index.js";

/**
 * Recursively find all .move files in a directory
 * @param dir - Directory to search
 * @param maxDepth - Maximum recursion depth (default: 10)
 * @param currentDepth - Current recursion depth (internal use)
 */
function findMoveFiles(dir: string, maxDepth: number = 10, currentDepth: number = 0): string[] {
  const files: string[] = [];

  // Prevent infinite loops from excessive recursion
  if (currentDepth > maxDepth) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip symlinks to prevent directory traversal and infinite loops
      if (entry.isSymbolicLink()) {
        continue;
      }
      files.push(...findMoveFiles(fullPath, maxDepth, currentDepth + 1));
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
export function extractNamedAddresses(moveDir: string): Set<string> {
  const addresses = new Set<string>();
  const moveFiles = findMoveFiles(moveDir);

  for (const file of moveFiles) {
    let content = fs.readFileSync(file, 'utf-8');

    // Strip comments to avoid false positives
    // Remove block comments /* ... */ (non-greedy, handles newlines)
    content = content.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Remove line comments // ... to end of line
    content = content.replace(/\/\/.*$/gm, ' ');

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

/**
 * List of dev addresses to use for auto-assignment (to avoid conflicts)
 */
const DEV_ADDRESSES = [
  "0xcafe",
  "0xbeef",
  "0xdead",
  "0xface",
  "0xfeed",
  "0xc0de",
  "0xbabe",
  "0xf00d",
];

/**
 * Update Move.toml with detected addresses
 * Adds missing addresses to [addresses] and [dev-addresses] sections
 */
export function updateMoveToml(moveDir: string, detectedAddresses: Set<string>): string[] {
  const moveTomlPath = path.join(moveDir, "Move.toml");
  
  if (!fs.existsSync(moveTomlPath)) {
    return [];
  }

  let content = fs.readFileSync(moveTomlPath, "utf-8");
  const addedAddresses: string[] = [];

  // Parse existing addresses from [addresses] section
  const existingAddresses = new Set<string>();
  const addressesMatch = content.match(/\[addresses\]([\s\S]*?)(?=\[|$)/);
  if (addressesMatch) {
    const addressesSection = addressesMatch[1];
    const addrRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm;
    let match;
    while ((match = addrRegex.exec(addressesSection)) !== null) {
      existingAddresses.add(match[1]);
    }
  }

  // Parse existing dev-addresses
  const existingDevAddresses = new Map<string, string>();
  const devAddressesMatch = content.match(/\[dev-addresses\]([\s\S]*?)(?=\[|$)/);
  if (devAddressesMatch) {
    const devSection = devAddressesMatch[1];
    const devRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"(0x[a-fA-F0-9]+)"/gm;
    let match;
    while ((match = devRegex.exec(devSection)) !== null) {
      existingDevAddresses.set(match[1], match[2].toLowerCase());
    }
  }

  // Get used dev addresses to avoid conflicts
  const usedDevAddresses = new Set(existingDevAddresses.values());

  // Find addresses that need to be added
  const missingAddresses: string[] = [];
  for (const addr of detectedAddresses) {
    if (!existingAddresses.has(addr)) {
      missingAddresses.push(addr);
    }
  }

  if (missingAddresses.length === 0) {
    return [];
  }

  // Assign unique dev addresses to new addresses
  const newDevAddresses: Map<string, string> = new Map();
  let devAddrIndex = 0;
  
  for (const addr of missingAddresses) {
    // Find next available dev address
    while (devAddrIndex < DEV_ADDRESSES.length && usedDevAddresses.has(DEV_ADDRESSES[devAddrIndex])) {
      devAddrIndex++;
    }
    
    if (devAddrIndex < DEV_ADDRESSES.length) {
      newDevAddresses.set(addr, DEV_ADDRESSES[devAddrIndex]);
      usedDevAddresses.add(DEV_ADDRESSES[devAddrIndex]);
      devAddrIndex++;
    } else {
      // Generate a unique address if we run out of predefined ones
      const uniqueAddr = `0x${(0x1000 + devAddrIndex).toString(16)}`;
      newDevAddresses.set(addr, uniqueAddr);
      devAddrIndex++;
    }
  }

  // Update [addresses] section
  if (addressesMatch) {
    const addressesSection = addressesMatch[1];
    const newLines = missingAddresses.map(addr => `${addr} = "_"`).join("\n");
    const updatedSection = addressesSection.trimEnd() + "\n" + newLines + "\n";
    content = content.replace(addressesMatch[0], `[addresses]${updatedSection}`);
  }

  // Update [dev-addresses] section
  const updatedDevMatch = content.match(/\[dev-addresses\]([\s\S]*?)(?=\[|$)/);
  if (updatedDevMatch) {
    const devSection = updatedDevMatch[1];
    const newDevLines = missingAddresses.map(addr => `${addr} = "${newDevAddresses.get(addr)}"`).join("\n");
    // Remove trailing comments/whitespace before adding new lines
    const cleanedSection = devSection.replace(/\n*$/, "\n");
    const updatedDevSection = cleanedSection + newDevLines + "\n";
    content = content.replace(updatedDevMatch[0], `[dev-addresses]${updatedDevSection}`);
  }

  // Write updated content
  fs.writeFileSync(moveTomlPath, content);
  
  return missingAddresses;
}

function run(command: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    exec(command, {
      cwd,
      timeout: 120000, // 2 minutes for git dependency downloads
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    }, (error, stdout, stderr) => {
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

/**
 * Compile Move smart contracts using the Movement CLI
 *
 * This command:
 * - Detects named addresses used in Move modules
 * - Auto-updates Move.toml with missing addresses
 * - Merges auto-detected addresses with user-configured addresses
 * - Auto-assigns development addresses for missing addresses
 * - Executes `movement move build` with proper named address mappings
 *
 * @example
 * // Compile contracts in default ./move directory
 * await compileCommand();
 */
export default async function compileCommand() {
  try {
    // Compile is network-independent - only uses global config
    const userConfig = await loadUserConfig();

    logger.newline();
    logger.info('Compiling Move contracts...');

    const moveDir = path.resolve(process.cwd(), userConfig.moveDir || "./move");
    if (!fs.existsSync(moveDir)) {
      logger.error(`Move directory not found: ${moveDir}`);
      logger.plain(`   Update movehat.config.ts -> moveDir`);
      logger.newline();
      process.exit(1);
    }

    // Validate and escape to prevent command injection
    const safeMoveDir = validateAndEscapePath(moveDir, "Move directory");

    // Auto-detect named addresses from Move files
    const detectedAddresses = extractNamedAddresses(moveDir);

    // Auto-update Move.toml with missing addresses
    const addedToToml = updateMoveToml(moveDir, detectedAddresses);
    if (addedToToml.length > 0) {
      logger.success(`Added ${addedToToml.length} address(es) to Move.toml: ${addedToToml.join(", ")}`);
    }

    // Merge user-configured addresses with auto-detected ones
    const namedAddresses = { ...(userConfig.namedAddresses ?? {}) };
    const autoAssignedAddresses: string[] = [];

    // For any detected address not in config, use a dev address
    for (const addr of detectedAddresses) {
      if (!namedAddresses[addr]) {
        namedAddresses[addr] = "0xcafe"; // Dev address for compilation
        autoAssignedAddresses.push(addr);
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

    logger.kv('Move directory', moveDir, 2);
    if (detectedAddresses.size > 0) {
      logger.kv('Detected addresses', Array.from(detectedAddresses).join(", "), 2);
    }
    if (Object.keys(userConfig.namedAddresses ?? {}).length > 0) {
      logger.kv('Configured addresses', Object.keys(userConfig.namedAddresses!).join(", "), 2);
    }
    if (autoAssignedAddresses.length > 0) {
      logger.kv('Auto-assigned (0xcafe)', autoAssignedAddresses.join(", "), 2);
    }
    logger.newline();

    await run(command, moveDir);

    logger.newline();
    logger.success('Compilation finished successfully');
    logger.newline();
  } catch (err: any) {
    logger.newline();
    logger.error(`Compilation failed: ${err.message ?? err}`);
    logger.newline();
    process.exit(1);
  }
}
