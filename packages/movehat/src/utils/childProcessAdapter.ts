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
  exitCode: number;
  stdout: string;
  stderr: string;
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

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        input.signal?.removeEventListener('abort', onAbort);
        resolve({
          exitCode: code ?? 0,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
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
