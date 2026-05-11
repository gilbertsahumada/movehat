import { spawn } from 'node:child_process';

/**
 * Injectable abstraction over `child_process.spawn`.
 *
 * Tests inject a fake adapter; production code uses `defaultChildProcessAdapter`.
 * Higher-level helpers (see `runCli`) wrap this with redaction and error handling.
 */
export interface ChildProcessAdapter {
  run(input: RunInput): Promise<RunResult>;
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
}

export const defaultChildProcessAdapter: ChildProcessAdapter = new DefaultChildProcessAdapter();
