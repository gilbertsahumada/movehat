import { existsSync } from "fs";
import { homedir } from "os";
import { extname, join } from "path";
import { randomUUID } from "crypto";
import type { MovehatRuntime } from "../types/runtime.js";
import type {
  RunMoveScriptOptions,
  MoveScriptResult,
} from "../types/harness.js";
import { validatePathSafety, validateProfileSafety } from "../core/shell.js";
import { CliExecutionError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { parseTxHash } from "../utils/parseCliOutput.js";
import { logger } from "../ui/index.js";
import {
  withYamlLock,
  addProfile,
  removeProfile,
  removeProfileSync,
  ensureSignalHandler,
  cleanupCallbacks,
} from "../core/movementProfile.js";

/**
 * Execute a Move script via `movement move run-script`.
 *
 * Auto-detects the script kind from the extension:
 *   - `.move` source → `--script-path` (CLI compiles inline)
 *   - `.mv` compiled bytecode → `--compiled-script-path`
 *
 * Reuses Publisher's security model via the shared `movementProfile`
 * helpers: per-deploy unique profile, atomic 0o600 yaml writes under
 * the mutex, SIGINT-safe sync cleanup, `--profile` auth (key never
 * appears in `ps` output).
 *
 * Returns {@link MoveScriptResult}. `txHash` is guaranteed; `success`
 * and `vmStatus` are best-effort parsed from the CLI's Result JSON.
 *
 * @internal — called from `Harness.runMoveScript`.
 */
export async function runMoveScript(
  runtime: MovehatRuntime,
  options: RunMoveScriptOptions
): Promise<MoveScriptResult> {
  const config = runtime.config;
  const account = runtime.account;

  // Synchronous validation before any CLI call.
  if (!options.scriptPath || typeof options.scriptPath !== "string") {
    throw new Error(
      "Harness.runMoveScript requires options.scriptPath (string path to .move or .mv)."
    );
  }
  const ext = extname(options.scriptPath).toLowerCase();
  let scriptFlag: "--script-path" | "--compiled-script-path";
  if (ext === ".move") {
    scriptFlag = "--script-path";
  } else if (ext === ".mv") {
    scriptFlag = "--compiled-script-path";
  } else {
    throw new Error(
      `Harness.runMoveScript: unsupported script extension '${ext || "<none>"}'. ` +
        `Expected '.move' (source — CLI auto-compiles) or '.mv' (pre-compiled bytecode).`
    );
  }
  if (!existsSync(options.scriptPath)) {
    throw new Error(
      `Harness.runMoveScript: script not found at '${options.scriptPath}'.`
    );
  }

  const safeScriptPath = validatePathSafety(options.scriptPath, "script path");
  const profile = `movehat-script-${randomUUID().slice(0, 8)}`;
  const safeProfile = validateProfileSafety(profile);

  logger.step(
    `Running Move script '${options.scriptPath}' on ${config.network}...`
  );

  try {
    const deployerAddress = account.accountAddress.toString();

    let cleanPrivateKey = config.privateKey;
    if (cleanPrivateKey.startsWith("ed25519-priv-")) {
      cleanPrivateKey = cleanPrivateKey.replace("ed25519-priv-", "");
    }

    const movementConfigPath = join(homedir(), ".aptos", "config.yaml");

    ensureSignalHandler();
    const syncCleanup = () => removeProfileSync(movementConfigPath, profile);
    cleanupCallbacks.add(syncCleanup);

    await withYamlLock(() =>
      addProfile(movementConfigPath, profile, {
        private_key: cleanPrivateKey,
        public_key: account.publicKey.toString(),
        account: deployerAddress,
        rest_url: config.rpc,
      })
    );

    let scriptOut = "";
    try {
      const typeArgsFragment: string[] =
        options.typeArgs && options.typeArgs.length > 0
          ? ["--type-args", ...options.typeArgs]
          : [];
      const argsFragment: string[] =
        options.args && options.args.length > 0
          ? ["--args", ...options.args]
          : [];

      const result = await runCli(
        {
          command: "movement",
          args: [
            "move",
            "run-script",
            "--profile",
            safeProfile,
            "--url",
            config.rpc,
            "--assume-yes",
            scriptFlag,
            safeScriptPath,
            ...typeArgsFragment,
            ...argsFragment,
          ],
          timeoutMs: 120000,
        },
        { adapter: options.adapter }
      );
      scriptOut = result.stdout;
      if (result.stdout) console.log(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
    } finally {
      await withYamlLock(() => removeProfile(movementConfigPath, profile)).catch(
        (err) => {
          const cleanupMsg = err instanceof Error ? err.message : String(err);
          logger.warning(
            `Failed to remove script profile "${profile}" from ${movementConfigPath}: ${cleanupMsg}. ` +
              `Run 'movement config delete-profile --profile ${profile}' to clean up manually.`
          );
        }
      );
      cleanupCallbacks.delete(syncCleanup);
    }

    const txHash = parseTxHash(scriptOut);
    if (!txHash) {
      throw new Error(
        `Could not parse transaction hash from 'move run-script' output. ` +
          `Captured stdout:\n${scriptOut.slice(0, 1000)}`
      );
    }

    const success = parseSuccess(scriptOut);
    const vmStatus = parseVmStatus(scriptOut);

    logger.success(`Move script executed (tx ${txHash}).`);

    const out: MoveScriptResult = { txHash };
    if (success !== undefined) out.success = success;
    if (vmStatus !== undefined) out.vmStatus = vmStatus;
    return out;
  } catch (error) {
    if (error instanceof CliExecutionError) {
      if (error.stdoutPreview) console.log(error.stdoutPreview);
      logger.error(`Failed to run Move script: ${error.message}\n${error.stderr}`);
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to run Move script: ${err.message}`);
    }
    throw error;
  }
}

/**
 * Best-effort parse of the `"success": true|false` field from
 * Movement CLI's Result JSON block. Returns `undefined` on no match.
 */
function parseSuccess(stdout: string): boolean | undefined {
  const m = stdout.match(/"success"\s*:\s*(true|false)/);
  if (!m) return undefined;
  return m[1] === "true";
}

/**
 * Best-effort parse of the `"vm_status"` string. Returns `undefined`
 * on no match.
 */
function parseVmStatus(stdout: string): string | undefined {
  const m = stdout.match(/"vm_status"\s*:\s*"([^"]*)"/);
  return m?.[1];
}
