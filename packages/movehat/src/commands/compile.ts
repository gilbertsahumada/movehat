import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { loadUserConfig } from "../core/config.js";
import { validateAndEscapePath, escapeShellArg } from "../core/shell.js";

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

    console.log("📦 Compiling Move contracts (network-independent)...");

    const moveDir = path.resolve(process.cwd(), userConfig.moveDir || "./move");
    if (!fs.existsSync(moveDir)) {
      console.error(`❌ Move directory not found: ${moveDir}`);
      console.error(`   Update movehat.config.ts -> moveDir`);
      return;
    }

    // Validate and escape to prevent command injection
    const safeMoveDir = validateAndEscapePath(moveDir, "Move directory");

    // Use global named addresses for compilation
    const namedAddresses = userConfig.namedAddresses ?? {};
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
    if (Object.keys(namedAddresses).length > 0) {
      console.log(`   Named addresses: ${Object.keys(namedAddresses).join(", ")}`);
    }
    console.log();

    await run(command, moveDir);
    console.log("✅ Compilation finished successfully.");
  } catch (err: any) {
    console.error("❌ Compilation failed:", err.message ?? err);
    process.exit(1);
  }
}
