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
  const config = await loadUserConfig();
  const moveDir = path.resolve(process.cwd(), config.moveDir);
  if (!fs.existsSync(moveDir)) {
    console.error(`Move directory not found: ${moveDir}. Update movehat.config.ts -> moveDir.`);
    return;
  }

  const namedAddresses = config.namedAddresses ?? {};
  const namedAddressesArg =
    Object.keys(namedAddresses).length > 0
      ? `--named-addresses ${Object.entries(namedAddresses)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`
      : "";

  const command = `movement move build --package-dir ${moveDir} ${namedAddressesArg}`.trim();

  console.log(`Compiling Move package in ${moveDir}...`);
  try {
    await run(command, moveDir);
    console.log("Compilation finished successfully.");
  } catch (err: any) {
    console.error("Compilation failed. Is the Movement CLI installed and on your PATH?");
    console.error(err.message ?? err);
  }
}
