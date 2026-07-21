import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';
import { CliExecutionError } from '../../errors.js';
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from '../childProcessAdapter.js';
import { redactSecrets, runCli, runCliUntilInterrupted } from '../runCli.js';

function makeAdapter(result: RunResult, capture?: { last?: RunInput }): ChildProcessAdapter {
  return {
    async run(input) {
      if (capture) capture.last = input;
      return result;
    },
    spawn() {
      throw new Error('spawn not used in runCli tests');
    },
  };
}

describe('redactSecrets', () => {
  it('replaces ed25519-priv-0x… literals', () => {
    const key = '0x' + 'a'.repeat(64);
    const input = `Loaded key ed25519-priv-${key} ok`;
    expect(redactSecrets(input)).toBe('Loaded key ***REDACTED*** ok');
  });

  it('replaces AIP-80 private-key literals with other key schemes', () => {
    const key = '0x' + '1'.repeat(64);
    const input = `Loaded key secp256k1-priv-${key} ok`;
    expect(redactSecrets(input)).toBe('Loaded key ***REDACTED*** ok');
  });

  it('redacts private_key labelled values', () => {
    const input = 'private_key: 0x' + 'b'.repeat(64);
    expect(redactSecrets(input)).toBe('***REDACTED***');
  });

  it('redacts priv-key labelled values with hyphen variants', () => {
    const input = 'priv-key = 0x' + 'c'.repeat(64);
    expect(redactSecrets(input)).toBe('***REDACTED***');
  });

  it('redacts raw private keys next to CLI key flags', () => {
    const input = '--private-key 0x' + 'd'.repeat(64);
    expect(redactSecrets(input)).toBe('***REDACTED***');
  });

  it('redacts raw private keys before nearby key context', () => {
    const input = '0x' + 'e'.repeat(64) + ' private key loaded';
    expect(redactSecrets(input)).toBe('***REDACTED*** private key loaded');
  });

  it('leaves regular hex addresses alone', () => {
    const input = 'Account 0x1234 deployed module counter';
    expect(redactSecrets(input)).toBe(input);
  });

  it('leaves full-length account addresses alone without key context', () => {
    const input = 'Account 0x' + 'f'.repeat(64) + ' deployed module counter';
    expect(redactSecrets(input)).toBe(input);
  });

  it('is a no-op on empty input', () => {
    expect(redactSecrets('')).toBe('');
  });
});

describe('runCli', () => {
  it('returns redacted stdout and stderr on success', async () => {
    const key = 'ed25519-priv-0x' + 'a'.repeat(64);
    const adapter = makeAdapter({
      exitCode: 0,
      stdout: `ok ${key}`,
      stderr: '',
    });

    const result = await runCli({ command: 'fake', args: [] }, { adapter });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok ***REDACTED***');
    expect(result.stderr).toBe('');
  });

  it('throws CliExecutionError with redacted stderr on non-zero exit', async () => {
    const adapter = makeAdapter({
      exitCode: 1,
      stdout: '',
      stderr: 'boom private_key: 0x' + 'd'.repeat(64),
    });

    await expect(
      runCli({ command: 'movement', args: ['publish'] }, { adapter })
    ).rejects.toMatchObject({
      name: 'CliExecutionError',
      command: 'movement',
      exitCode: 1,
    });

    try {
      await runCli({ command: 'movement', args: ['publish'] }, { adapter });
    } catch (e) {
      expect(e).toBeInstanceOf(CliExecutionError);
      const err = e as CliExecutionError;
      expect(err.stderr).toBe('boom ***REDACTED***');
      expect(err.stderr).not.toContain('private_key');
      expect(err.args).toEqual(['publish']);
    }
  });

  it('does not throw on non-zero exit when throwOnNonZeroExit is false', async () => {
    const adapter = makeAdapter({
      exitCode: 2,
      stdout: 'partial',
      stderr: 'warn',
    });

    const result = await runCli(
      { command: 'fake', args: [] },
      { adapter, throwOnNonZeroExit: false }
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('partial');
    expect(result.stderr).toBe('warn');
  });

  it('passes the input through to the adapter unchanged', async () => {
    const capture: { last?: RunInput } = {};
    const adapter = makeAdapter({ exitCode: 0, stdout: '', stderr: '' }, capture);
    const env = { FOO: 'bar' };
    const signal = new AbortController().signal;

    await runCli(
      {
        command: 'movement',
        args: ['move', 'build'],
        cwd: '/tmp/pkg',
        env,
        stdin: 'hello',
        timeoutMs: 1234,
        signal,
      },
      { adapter }
    );

    expect(capture.last).toEqual({
      command: 'movement',
      args: ['move', 'build'],
      cwd: '/tmp/pkg',
      env,
      stdin: 'hello',
      timeoutMs: 1234,
      signal,
    });
  });

  it('resolves movement and sanitizes env when using the default adapter', async () => {
    const result = await runCli(
      {
        command: 'movement',
        args: [
          '-e',
          "process.stdout.write(process.env.PRIVATE_KEY ? 'leaked' : (process.env.PATH ? 'sanitized' : 'missing-path'))",
        ],
        env: {
          PATH: process.env.PATH ?? '',
          MOVEHAT_MOVEMENT_BIN: process.execPath,
          PRIVATE_KEY: '0x' + 'a'.repeat(64),
        },
      },
      { throwOnNonZeroExit: false }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('sanitized');
  });

  it('truncates stdoutPreview on CliExecutionError', async () => {
    const longStdout = 'x'.repeat(5000);
    const adapter = makeAdapter({
      exitCode: 1,
      stdout: longStdout,
      stderr: '',
    });

    try {
      await runCli({ command: 'fake', args: [] }, { adapter });
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliExecutionError;
      expect(err.stdoutPreview.length).toBe(2000);
    }
  });

  it('redacts secret-shaped args inside CliExecutionError.args', async () => {
    const key = 'ed25519-priv-0x' + 'a'.repeat(64);
    const adapter = makeAdapter({ exitCode: 1, stdout: '', stderr: '' });

    try {
      await runCli(
        { command: 'movement', args: ['publish', '--private-key', key] },
        { adapter }
      );
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliExecutionError;
      expect(err.args[0]).toBe('publish');
      expect(err.args[1]).toBe('--private-key');
      expect(err.args[2]).toBe('***REDACTED***');
    }
  });

  it('preserves non-secret args unchanged', async () => {
    const adapter = makeAdapter({ exitCode: 1, stdout: '', stderr: '' });
    const args = ['move', 'publish', '--package-dir', '/tmp/pkg'];

    try {
      await runCli({ command: 'movement', args }, { adapter });
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliExecutionError;
      expect(Array.from(err.args)).toEqual(args);
    }
  });

  it('forwards inheritStdio flag to the adapter unchanged', async () => {
    const capture: { last?: RunInput } = {};
    const adapter = makeAdapter(
      { exitCode: 0, stdout: '', stderr: '' },
      capture
    );

    await runCli(
      { command: 'mocha', args: ['--watch'], inheritStdio: true },
      { adapter }
    );

    expect(capture.last?.inheritStdio).toBe(true);
  });

  it('propagates AbortSignal to a slow adapter and returns the killed result', async () => {
    const slowAdapter: ChildProcessAdapter = {
      run(input) {
        return new Promise((resolve) => {
          const t = setTimeout(
            () => resolve({ exitCode: 0, stdout: '', stderr: '' }),
            5000
          );
          input.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            resolve({
              exitCode: -1,
              stdout: '',
              stderr: '',
              signal: 'SIGTERM',
            });
          });
        });
      },
      spawn() {
        throw new Error('spawn not used in this test');
      },
    };

    const controller = new AbortController();
    const start = Date.now();
    const promise = runCli(
      { command: 'movement', args: ['move', 'test'], signal: controller.signal },
      { adapter: slowAdapter, throwOnNonZeroExit: false }
    );
    setTimeout(() => controller.abort(), 20);

    const result = await promise;
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(-1);
    expect(result.signal).toBe('SIGTERM');
    expect(elapsed).toBeLessThan(500);
  });
});

describe('runCliUntilInterrupted', () => {
  it('forwards SIGINT, awaits child shutdown, and records a clean shell status', async () => {
    const signalProcess = Object.assign(new EventEmitter(), {
      exitCode: undefined as number | undefined,
    });
    let childClosed = false;
    const adapter: ChildProcessAdapter = {
      run(input) {
        return new Promise((resolve) => {
          input.signal?.addEventListener('abort', () => {
            childClosed = true;
            resolve({ exitCode: -1, stdout: '', stderr: '', signal: 'SIGTERM' });
          });
        });
      },
      spawn() {
        throw new Error('spawn not used');
      },
    };

    const pending = runCliUntilInterrupted(
      { command: 'mocha', args: ['--watch'], timeoutMs: Infinity },
      { adapter },
      signalProcess
    );
    signalProcess.emit('SIGINT');
    const result = await pending;

    expect(childClosed).toBe(true);
    expect(result.signal).toBe('SIGTERM');
    expect(result.interruptedByParent).toBe('SIGINT');
    expect(signalProcess.exitCode).toBe(130);
    expect(signalProcess.listenerCount('SIGINT')).toBe(0);
    expect(signalProcess.listenerCount('SIGTERM')).toBe(0);
  });

  it('preserves an explicit throwOnNonZeroExit override', async () => {
    const signalProcess = Object.assign(new EventEmitter(), {
      exitCode: undefined as number | undefined,
    });
    const adapter = makeAdapter({ exitCode: 7, stdout: '', stderr: 'failed' });

    await expect(
      runCliUntilInterrupted(
        { command: 'movement', args: ['move', 'test'], timeoutMs: Infinity },
        { adapter, throwOnNonZeroExit: true },
        signalProcess
      )
    ).rejects.toBeInstanceOf(CliExecutionError);

    expect(signalProcess.listenerCount('SIGINT')).toBe(0);
    expect(signalProcess.listenerCount('SIGTERM')).toBe(0);
  });

  it('keeps intercepting repeated signals until the child has closed', async () => {
    const signalProcess = Object.assign(new EventEmitter(), {
      exitCode: undefined as number | undefined,
    });
    let finishShutdown!: () => void;
    let abortEvents = 0;
    const adapter: ChildProcessAdapter = {
      run(input) {
        return new Promise((resolve) => {
          input.signal?.addEventListener('abort', () => {
            abortEvents += 1;
            finishShutdown = () =>
              resolve({ exitCode: -1, stdout: '', stderr: '', signal: 'SIGTERM' });
          });
        });
      },
      spawn() {
        throw new Error('spawn not used');
      },
    };

    let settled = false;
    const pending = runCliUntilInterrupted(
      { command: 'mocha', args: ['--watch'], timeoutMs: Infinity },
      { adapter, throwOnNonZeroExit: false },
      signalProcess
    ).finally(() => {
      settled = true;
    });

    signalProcess.emit('SIGINT');
    signalProcess.emit('SIGINT');
    signalProcess.emit('SIGTERM');
    await Promise.resolve();

    expect(abortEvents).toBe(1);
    expect(settled).toBe(false);
    expect(signalProcess.listenerCount('SIGINT')).toBe(1);
    expect(signalProcess.listenerCount('SIGTERM')).toBe(1);

    finishShutdown();
    const result = await pending;

    expect(result.interruptedByParent).toBe('SIGINT');
    expect(signalProcess.exitCode).toBe(130);
    expect(signalProcess.listenerCount('SIGINT')).toBe(0);
    expect(signalProcess.listenerCount('SIGTERM')).toBe(0);
  });
});
