import { CliExecutionError } from '../errors.js';
import {
  defaultChildProcessAdapter,
  type ChildProcessAdapter,
  type RunInput,
  type RunResult,
} from './childProcessAdapter.js';
import { redactSecrets } from './redact.js';

export { redactSecrets } from './redact.js';

const STDOUT_PREVIEW_CHARS = 2000;

export interface RunCliOptions {
  /** Override the child-process adapter (defaults to spawn-based). */
  adapter?: ChildProcessAdapter | undefined;
  /** When true (default), throw `CliExecutionError` on non-zero exit. */
  throwOnNonZeroExit?: boolean | undefined;
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

  const raw = await adapter.run(input);
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
