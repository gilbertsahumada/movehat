import { CliExecutionError } from '../errors.js';
import {
  defaultChildProcessAdapter,
  type ChildProcessAdapter,
  type RunInput,
  type RunResult,
} from './childProcessAdapter.js';
import { resolveMovementBinary, sanitizeMovementEnv } from './movementCli.js';
import { redactSecrets } from './redact.js';

export { redactSecrets } from './redact.js';

const STDOUT_PREVIEW_CHARS = 2000;

export interface RunCliOptions {
  /** Override the child-process adapter (defaults to spawn-based). */
  adapter?: ChildProcessAdapter | undefined;
  /** When true (default), throw `CliExecutionError` on non-zero exit. */
  throwOnNonZeroExit?: boolean | undefined;
}

export interface InterruptSignalProcess {
  exitCode: string | number | null | undefined;
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/**
 * Spawns a CLI command through the injectable adapter, redacts well-known
 * secret shapes from stdout and stderr before returning, and throws
 * `CliExecutionError` (with already-redacted payloads) on non-zero exits.
 *
 * Callers that need to inspect raw output should set `throwOnNonZeroExit:false`
 * and consume the returned `RunResult` directly — fields are still redacted.
 *
 * Pass `input.inheritStdio: true` for interactive commands (mocha, tsx,
 * package managers) where the user expects to see live output. Under that
 * flag, `stdout` and `stderr` in the returned `RunResult` are empty strings
 * (and so is `stdoutPreview` on any `CliExecutionError`), since the child
 * writes directly to the terminal rather than to a captured buffer.
 */
export async function runCli(
  input: RunInput,
  options: RunCliOptions = {}
): Promise<RunResult> {
  const adapter = options.adapter ?? defaultChildProcessAdapter;
  const throwOnNonZeroExit = options.throwOnNonZeroExit ?? true;
  const movementResolveOptions = input.env ? { env: input.env } : {};
  const runInput =
    input.command === 'movement' && options.adapter === undefined
      ? {
          ...input,
          command: resolveMovementBinary(movementResolveOptions),
          env: sanitizeMovementEnv(input.env ?? process.env),
        }
      : input;

  const raw = await adapter.run(runInput);
  const result: RunResult = {
    exitCode: raw.exitCode,
    stdout: redactSecrets(raw.stdout),
    stderr: redactSecrets(raw.stderr),
  };
  if (raw.signal) {
    result.signal = raw.signal;
  }

  if (result.exitCode !== 0 && throwOnNonZeroExit) {
    throw new CliExecutionError(
      `Command failed with exit code ${result.exitCode}: ${input.command}`,
      input.command,
      input.args,
      result.exitCode,
      result.stderr,
      result.stdout.slice(0, STDOUT_PREVIEW_CHARS)
    );
  }

  return result;
}

/**
 * Run an attached child until it exits, forwarding parent termination signals
 * through an AbortSignal so a signal aimed only at Movehat cannot orphan the
 * child. The parent exits naturally with the conventional shell status after
 * the child has closed, which keeps Ctrl+C output free of stack traces.
 */
export async function runCliUntilInterrupted(
  input: RunInput,
  options: RunCliOptions = {},
  signalProcess: InterruptSignalProcess = process
): Promise<RunResult> {
  const controller = new AbortController();
  let receivedSignal: "SIGINT" | "SIGTERM" | undefined;
  const onSigint = () => {
    receivedSignal ??= "SIGINT";
    controller.abort();
  };
  const onSigterm = () => {
    receivedSignal ??= "SIGTERM";
    controller.abort();
  };

  // Keep both listeners installed until the child has closed. Removing a
  // one-shot listener after the first signal would restore Node's default
  // behaviour, letting a second Ctrl+C kill Movehat before child cleanup.
  signalProcess.on("SIGINT", onSigint);
  signalProcess.on("SIGTERM", onSigterm);
  try {
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    // The wrapper must observe the child's final result before callers decide
    // how to handle it, otherwise runCli's default non-zero exception would
    // prevent us from attaching the parent signal that caused the shutdown.
    // An explicit caller override remains authoritative.
    const interruptOptions: RunCliOptions = {
      ...options,
      throwOnNonZeroExit: options.throwOnNonZeroExit ?? false,
    };
    const result = await runCli({ ...input, signal }, interruptOptions);
    if (receivedSignal) {
      result.interruptedByParent = receivedSignal;
    }
    return result;
  } finally {
    signalProcess.removeListener("SIGINT", onSigint);
    signalProcess.removeListener("SIGTERM", onSigterm);
    if (receivedSignal && signalProcess.exitCode == null) {
      signalProcess.exitCode = receivedSignal === "SIGINT" ? 130 : 143;
    }
  }
}
