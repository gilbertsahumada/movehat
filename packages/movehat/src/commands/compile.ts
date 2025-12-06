import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { loadUserConfig } from "../helpers/config.js";

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

    // Use global named addresses for compilation
    const namedAddresses = userConfig.namedAddresses ?? {};
    const namedAddressesArg =
      Object.keys(namedAddresses).length > 0
        ? `--named-addresses ${Object.entries(namedAddresses)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")}`
        : "";

    const command = `movement move build --package-dir ${moveDir} ${namedAddressesArg}`.trim();

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
