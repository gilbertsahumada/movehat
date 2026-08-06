import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import type { MovehatRuntime } from "../types/runtime.js";
import type {
  RunMoveScriptOptions,
  MoveScriptResult,
} from "../types/harness.js";
import { validatePathSafety } from "../core/shell.js";
import { CliExecutionError, TransactionOutcomeUnknownError } from "../errors.js";
import { runCli } from "../utils/runCli.js";
import { parseTxHash } from "../utils/parseCliOutput.js";
import { parseScriptArgs } from "../utils/scriptArgs.js";
import { redactSecrets } from "../utils/redact.js";
import { logger, isVerbose } from "../ui/index.js";
import {
  writeTempKeyFile,
  removeKeyFile,
  removeKeyFileSyncBestEffort,
  ensureSignalHandler,
  cleanupCallbacks,
} from "../core/movementProfile.js";

/**
 * Execute a Move script.
 *
 * Default path wraps `movement move run-script`, auto-detecting the
 * script kind from the extension:
 *   - `.move` source → `--script-path` (CLI compiles inline)
 *   - `.mv` compiled bytecode → `--compiled-script-path`
 *
 * With `options.sdkExecute` (defaulted to true by `Harness` on the
 * movelite backend) the `.mv` bytecode is submitted through the
 * TypeScript SDK instead — see `runScriptViaSdk`. `.move` sources are
 * rejected on that path (no inline compilation).
 *
 * The CLI path reuses Publisher's security model via the shared
 * `movementProfile` helpers: per-invocation temp key file (0o600),
 * SIGINT-safe sync cleanup, `--private-key-file` auth (key never
 * appears in `ps` output or in the user's `~/.aptos/config.yaml`).
 *
 * Returns {@link MoveScriptResult}. `txHash` is guaranteed; `success`
 * and `vmStatus` are best-effort parsed from the CLI's Result JSON
 * (CLI path) or taken from the committed transaction (SDK path).
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
  if (options.sdkExecute && ext === ".move") {
    throw new Error(
      `Harness.runMoveScript: uncompiled '.move' scripts are not supported on the ` +
        `SDK execution path (used automatically on the movelite backend). ` +
        `Pre-compile the containing package with 'movement move compile' and pass ` +
        `the emitted 'build/<pkg>/bytecode_scripts/<name>.mv', or run against a ` +
        `full Movement node (useMovelite: false).`
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

  if (options.sdkExecute) {
    return runScriptViaSdk(runtime, safeScriptPath, options);
  }

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
 * Execute a pre-compiled `.mv` script through the TypeScript SDK.
 *
 * Used on backends whose REST responses the Movement CLI cannot parse
 * (movelite). Signs in-process — no temp key file, no signal-handler
 * cleanup. Scripts have no on-chain ABI, so `options.args` (CLI-style
 * `"type:value"` strings) are marshalled into BCS wrapper instances by
 * `parseScriptArgs` before payload construction.
 *
 * Mirrors the CLI path's outcome contract: a committed-but-failed
 * transaction returns `success: false` instead of throwing.
 */
async function runScriptViaSdk(
  runtime: MovehatRuntime,
  scriptPath: string,
  options: RunMoveScriptOptions
): Promise<MoveScriptResult> {
  const aptos = runtime.aptos;
  const account = runtime.account;

  const functionArguments = parseScriptArgs(options.args ?? []);
  const bytecode = new Uint8Array(readFileSync(scriptPath));

  try {
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        bytecode,
        typeArguments: options.typeArgs ?? [],
        functionArguments,
      },
    });
    const senderAuthenticator = aptos.transaction.sign({
      signer: account,
      transaction,
    });
    const committed = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
    });

    let response;
    try {
      // checkSuccess: false — parity with the CLI path, which reports a
      // committed-but-failed script via `success`/`vmStatus` rather than
      // throwing.
      response = await aptos.waitForTransaction({
        transactionHash: committed.hash,
        options: { checkSuccess: false },
      });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const redactedCause = new Error(redactSecrets(cause.message));
      throw new TransactionOutcomeUnknownError(
        `Transaction ${committed.hash} was submitted, but its final status could not be confirmed: ${redactedCause.message}`,
        "run-script",
        committed.hash,
        undefined,
        redactedCause
      );
    }

    logger.success(`Move script executed (tx ${committed.hash}).`);

    const out: MoveScriptResult = { txHash: committed.hash };
    if (typeof response.success === "boolean") out.success = response.success;
    if (typeof response.vm_status === "string") out.vmStatus = response.vm_status;
    return out;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`Failed to run Move script: ${redactSecrets(err.message)}`);
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
