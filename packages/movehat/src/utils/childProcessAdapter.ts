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
  /**
   * When `true`, the child inherits the parent's stdio (stdout, stderr,
   * stdin go straight to the terminal). The resulting `RunResult.stdout`
   * and `RunResult.stderr` will be empty strings because nothing is
   * captured. Useful for interactive commands like `mocha`, `tsx`, or
   * `pnpm install` where the user expects to see live output.
   *
   * If `inheritStdio` is `true`, `stdin` on this input is ignored — the
   * child reads directly from the parent's stdin.
   *
   * Default: `false`.
   */
  inheritStdio?: boolean;
  /**
   * Maximum combined bytes (stdout + stderr) the captured Buffers may
   * grow to before the child is killed and the promise rejects. Defaults
   * to 64 MiB. Set to `Infinity` to disable. Ignored when
   * `inheritStdio` is `true` (no buffering happens).
   */
  maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

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
    // Skip the default 5-minute timeout when the caller wires stdio
    // through to the terminal — interactive sessions (mocha, tsx scripts,
    // `movement move test`, `pnpm install`) routinely exceed 5 minutes
    // and SIGTERM'ing them silently would be a regression. An explicit
    // `timeoutMs` is always honored, regardless of `inheritStdio`.
    const timeoutMs =
      input.timeoutMs ?? (input.inheritStdio ? undefined : DEFAULT_TIMEOUT_MS);

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env ?? process.env,
        stdio: input.inheritStdio ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let overflowed = false;
      const maxBuffer = input.maxBuffer ?? DEFAULT_MAX_BUFFER;

      const onChunk = (chunks: Buffer[]) => (chunk: Buffer) => {
        if (overflowed) return;
        totalBytes += chunk.length;
        if (totalBytes > maxBuffer) {
          overflowed = true;
          clearTimer();
          input.signal?.removeEventListener('abort', onAbort);
          child.kill('SIGTERM');
          reject(
            new Error(
              `Command output exceeded maxBuffer (${maxBuffer} bytes): ${input.command}`
            )
          );
          return;
        }
        chunks.push(chunk);
      };

      // Streams are null when stdio is 'inherit'; the `?.` covers that.
      child.stdout?.on('data', onChunk(stdoutChunks));
      child.stderr?.on('data', onChunk(stderrChunks));

      let timeoutHandle: NodeJS.Timeout | undefined;
      const clearTimer = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      if (timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${input.command}`));
        }, timeoutMs);
      }

      const onAbort = () => {
        child.kill('SIGTERM');
      };

      if (input.signal) {
        if (input.signal.aborted) {
          clearTimer();
          child.kill('SIGTERM');
          reject(new Error('Command aborted before start'));
          return;
        }
        input.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err) => {
        clearTimer();
        input.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (code, signal) => {
        clearTimer();
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

      // Under inheritStdio, child.stdin is null and the parent's stdin
      // is wired through; we just skip the close call. Otherwise, end()
      // either with the provided string or empty to close stdin cleanly.
      if (!input.inheritStdio) {
        if (input.stdin !== undefined) {
          child.stdin?.end(input.stdin);
        } else {
          child.stdin?.end();
        }
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

    // `exited` must settle whether the child dies via natural exit, kill,
    // or a spawn-time `error` (e.g. ENOENT). Both events resolve once;
    // a settled guard prevents double-resolve if both happen to fire.
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      let settled = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      };
      child.on('exit', (code, signal) => finish(code, signal));
      child.on('error', () => finish(null, null));
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
