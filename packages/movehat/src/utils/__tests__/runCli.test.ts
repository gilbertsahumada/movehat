import { describe, it, expect } from 'vitest';
import { CliExecutionError } from '../../errors.js';
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from '../childProcessAdapter.js';
import { redactSecrets, runCli } from '../runCli.js';

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

  it('redacts private_key labelled values', () => {
    const input = 'private_key: 0x' + 'b'.repeat(64);
    expect(redactSecrets(input)).toBe('***REDACTED***');
  });

  it('redacts priv-key labelled values with hyphen variants', () => {
    const input = 'priv-key = 0x' + 'c'.repeat(64);
    expect(redactSecrets(input)).toBe('***REDACTED***');
  });

  it('leaves regular hex addresses alone', () => {
    const input = 'Account 0x1234 deployed module counter';
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
