import { CliExecutionError } from '../errors.js';
import {
  defaultChildProcessAdapter,
  type ChildProcessAdapter,
  type RunInput,
  type RunResult,
} from './childProcessAdapter.js';

const STDOUT_PREVIEW_CHARS = 2000;

/**
 * Patterns that match well-known secret shapes Movement / Aptos tools emit on
 * stderr or stdout. The matched span is replaced with `***REDACTED***`.
 *
 * Order matters when patterns overlap: the longer / more specific shape goes
 * first.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /ed25519-priv-0x[0-9a-fA-F]{64}/g,
  /(private[_-]?key|priv[_-]?key|priv|key)\s*[:=]\s*0x[0-9a-fA-F]{32,}/gi,
];

/**
 * Replaces every match of every known secret pattern with `***REDACTED***`.
 * Pure function; the input string is not mutated.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '***REDACTED***');
  }
  return out;
}

export interface RunCliOptions {
  /** Override the child-process adapter (defaults to spawn-based). */
  adapter?: ChildProcessAdapter;
  /** When true (default), throw `CliExecutionError` on non-zero exit. */
  throwOnNonZeroExit?: boolean;
}

/**
 * Spawns a CLI command through the injectable adapter, redacts well-known
 * secret shapes from stdout and stderr before returning, and throws
 * `CliExecutionError` (with already-redacted payloads) on non-zero exits.
 *
 * Callers that need to inspect raw output should set `throwOnNonZeroExit:false`
 * and consume the returned `RunResult` directly — fields are still redacted.
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
