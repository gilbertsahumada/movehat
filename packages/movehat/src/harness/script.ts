import { existsSync } from "fs";
import { extname } from "path";
import { PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import type { MovehatRuntime } from "../types/runtime.js";
import type {
  RunMoveScriptOptions,
  MoveScriptResult,
} from "../types/harness.js";
import { validatePathSafety } from "../core/shell.js";
import { CliExecutionError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { parseTxHash } from "../utils/parseCliOutput.js";
import { logger, isVerbose } from "../ui/index.js";
import {
  writeTempKeyFile,
  removeKeyFile,
  removeKeyFileSyncBestEffort,
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
 * helpers: per-invocation temp key file (0o600), SIGINT-safe sync
 * cleanup, `--private-key-file` auth (key never appears in `ps`
 * output or in the user's `~/.aptos/config.yaml`).
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

  logger.step(
    `Running Move script '${options.scriptPath}' on ${config.network}...`
  );

  try {
    const deployerAddress = account.accountAddress.toString();

    // Format the private key into AIP-80 shape before writing to the
    // temp key file. `formatPrivateKey` is idempotent for already-
    // prefixed inputs.
    const formattedPrivateKey = PrivateKey.formatPrivateKey(
      config.privateKey,
      PrivateKeyVariants.Ed25519,
    );

    // Pass the private key via a 0o600 temp file (--private-key-file)
    // and the on-chain address via --sender-account. Avoids the CLI's
    // profile-yaml lookup chain entirely (no CWD / HOME / .aptos /
    // .movement dance, no CLI-variant dependency).
    const keyFilePath = writeTempKeyFile(formattedPrivateKey);

    // SIGINT-safe sync cleanup BEFORE the CLI call so the private key
    // never persists on disk after an abnormal exit. The signal-handler
    // path uses the best-effort variant because the event loop is dead
    // and we cannot logger.warning.
    ensureSignalHandler();
    const syncCleanup = () => removeKeyFileSyncBestEffort(keyFilePath);
    cleanupCallbacks.add(syncCleanup);

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
            "--private-key-file",
            keyFilePath,
            "--sender-account",
            deployerAddress,
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
      // Both streams gated behind isVerbose(); Movement CLI uses
      // stderr for progress messages too. Real failures throw via
      // CliExecutionError and are surfaced from the catch below.
      if (isVerbose() && result.stdout) logger.info(result.stdout.trim(), 2);
      if (isVerbose() && result.stderr) logger.info(result.stderr.trim(), 2);
    } finally {
      // Observable cleanup — emit a warning if the unlink failed and
      // the file is still on disk (private key would persist silently
      // otherwise).
      const cleanupErr = removeKeyFile(keyFilePath);
      if (cleanupErr) {
        logger.warning(
          `Failed to remove temp key file '${keyFilePath}': ${cleanupErr.message}. ` +
            `The file has mode 0o600 but should be removed manually: rm ${keyFilePath}`
        );
      }
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
      if (error.stdoutPreview) logger.info(error.stdoutPreview, 2);
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
