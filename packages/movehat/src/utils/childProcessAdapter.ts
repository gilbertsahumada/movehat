import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * Injectable abstraction over `child_process.spawn`.
 *
 * Tests inject a fake adapter; production code uses `defaultChildProcessAdapter`.
 * Higher-level helpers (see `runCli`) wrap this with redaction and error handling.
 *
 * Two affordances:
 *   - `run` for one-shot commands whose stdout/stderr fit in memory.
 *   - `spawn` for long-running children where the caller wants to stream
 *     output incrementally and decide when to kill the process.
 */
export interface ChildProcessAdapter {
  run(input: RunInput): Promise<RunResult>;
  spawn(input: SpawnInput): SpawnedProcess;
}

export interface RunInput {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  /**
   * Numeric exit code from the child. `-1` when the child was terminated by
   * a signal (no numeric exit code available) — in that case `signal` is
   * populated.
   */
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * Populated when the child died from a signal (e.g. external abort, kill
   * during shutdown). `undefined` for normal exits.
   */
  signal?: NodeJS.Signals;
}

/**
 * Input for `spawn()`. Mirrors the subset of `RunInput` that applies to
 * long-running children: no `stdin`, no `timeoutMs`, no `signal`. Callers
 * control the lifecycle via the returned `SpawnedProcess`.
 */
export interface SpawnInput {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * `'pipe'` (default) makes stdout/stderr/stdin streams available on the
   * returned `SpawnedProcess`. `'ignore'` silences the child entirely
   * (streams are `null`). For `'inherit'`, use `run` with `inheritStdio: true`
   * instead — the spawn handle isn't useful when the parent owns stdio.
   */
  stdio?: 'pipe' | 'ignore';
}

/**
 * Handle returned by `spawn()`. Callers can listen on streams, kill the
 * process, or await `exited` for the final exit code and signal.
 */
export interface SpawnedProcess {
  pid: number | undefined;
  stdout: Readable | null;
  stderr: Readable | null;
  stdin: Writable | null;
  kill(signal?: NodeJS.Signals): boolean;
  /**
   * Resolves once when the child exits, regardless of how the caller
   * triggered it (natural exit, `kill`, or process death). Safe to await
   * multiple times.
   */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

class DefaultChildProcessAdapter implements ChildProcessAdapter {
  run(input: RunInput): Promise<RunResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${input.command}`));
      }, timeoutMs);

      const onAbort = () => {
        child.kill('SIGTERM');
      };

      if (input.signal) {
        if (input.signal.aborted) {
          clearTimeout(timeoutHandle);
          child.kill('SIGTERM');
          reject(new Error('Command aborted before start'));
          return;
        }
        input.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        input.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        input.signal?.removeEventListener('abort', onAbort);
        const result: RunResult = {
          exitCode: code !== null ? code : -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        };
        if (signal) {
          result.signal = signal;
        }
        resolve(result);
      });

      if (input.stdin !== undefined) {
        child.stdin?.end(input.stdin);
      } else {
        child.stdin?.end();
      }
    });
  }

  spawn(input: SpawnInput): SpawnedProcess {
    const stdio = input.stdio ?? 'pipe';
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio,
    });

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });

    return {
      pid: child.pid,
      stdout: child.stdout,
      stderr: child.stderr,
      stdin: child.stdin,
      kill: (signal?: NodeJS.Signals) => child.kill(signal),
      exited,
    };
  }
}

export const defaultChildProcessAdapter: ChildProcessAdapter = new DefaultChildProcessAdapter();
