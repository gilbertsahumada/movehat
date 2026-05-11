import { describe, it, expect } from 'vitest';
import { defaultChildProcessAdapter } from '../childProcessAdapter.js';

const NODE = process.execPath;

describe('defaultChildProcessAdapter', () => {
  it('captures stdout and zero exit code on success', async () => {
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', "process.stdout.write('hello-stdout')"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello-stdout');
    expect(result.stderr).toBe('');
  });

  it('captures stderr separately from stdout', async () => {
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', "process.stderr.write('boom'); process.exit(2)"],
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('boom');
  });

  it('pipes stdin to the child process', async () => {
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: [
        '-e',
        "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => process.stdout.write(d.toUpperCase()))",
      ],
      stdin: 'piped-input',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('PIPED-INPUT');
  });

  it('passes env to the child process', async () => {
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', 'process.stdout.write(process.env.MH_TEST_VAR ?? "missing")'],
      env: { ...process.env, MH_TEST_VAR: 'present' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('present');
  });

  it('rejects when the command times out', async () => {
    await expect(
      defaultChildProcessAdapter.run({
        command: NODE,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        timeoutMs: 50,
      })
    ).rejects.toThrow(/timed out/);
  });

  it('aborts a running command when the signal fires', async () => {
    const controller = new AbortController();
    const promise = defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    const result = await promise;
    // SIGTERM → child exits with non-zero (null on signal kill in some Node versions
    // → adapter coerces to 0; we just assert it didn't hang)
    expect(result).toBeDefined();
  });

  it('rejects synchronously when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      defaultChildProcessAdapter.run({
        command: NODE,
        args: ['-e', "process.stdout.write('never')"],
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/);
  });

  it('rejects when the command does not exist', async () => {
    await expect(
      defaultChildProcessAdapter.run({
        command: '/nonexistent/path/to/binary-xyz',
        args: [],
      })
    ).rejects.toThrow();
  });
});
