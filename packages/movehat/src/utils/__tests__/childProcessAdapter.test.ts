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

  it('aborts a running command with exitCode -1 and signal SIGTERM', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    const result = await promise;
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(-1);
    expect(result.signal).toBe('SIGTERM');
    expect(elapsed).toBeLessThan(500);
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

describe('defaultChildProcessAdapter.spawn', () => {
  it('returns a handle with pid and streams, and exits cleanly when the child finishes on its own', async () => {
    const child = defaultChildProcessAdapter.spawn({
      command: NODE,
      args: ['-e', "process.stdout.write('hi'); process.exit(0)"],
    });

    expect(typeof child.pid).toBe('number');
    expect(child.stdout).not.toBeNull();
    expect(child.stderr).not.toBeNull();
    expect(child.stdin).not.toBeNull();

    let captured = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      captured += chunk.toString('utf8');
    });

    const result = await child.exited;
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(captured).toBe('hi');
  });

  it('kill(SIGTERM) terminates a long-running child and surfaces the signal in exited', async () => {
    const child = defaultChildProcessAdapter.spawn({
      command: NODE,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });

    const start = Date.now();
    const killed = child.kill('SIGTERM');
    expect(killed).toBe(true);

    const result = await child.exited;
    const elapsed = Date.now() - start;

    expect(result.signal).toBe('SIGTERM');
    expect(result.code).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });

  it('with stdio: ignore, exposes null streams but still resolves exited', async () => {
    const child = defaultChildProcessAdapter.spawn({
      command: NODE,
      args: ['-e', "process.stdout.write('hidden'); process.exit(0)"],
      stdio: 'ignore',
    });

    expect(child.stdout).toBeNull();
    expect(child.stderr).toBeNull();
    expect(child.stdin).toBeNull();

    const result = await child.exited;
    expect(result.code).toBe(0);
  });

  it('exited can be awaited more than once', async () => {
    const child = defaultChildProcessAdapter.spawn({
      command: NODE,
      args: ['-e', 'process.exit(7)'],
    });

    const first = await child.exited;
    const second = await child.exited;

    expect(first.code).toBe(7);
    expect(second.code).toBe(7);
  });
});

describe('defaultChildProcessAdapter.run with inheritStdio', () => {
  it('returns empty stdout and stderr when inheritStdio is true', async () => {
    // The child writes to stdout, but the parent inherits stdio so the bytes
    // never go through the captured pipe — the adapter cannot see them.
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', "process.stdout.write('would-be-captured'); process.exit(0)"],
      inheritStdio: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('still propagates exit code under inheritStdio', async () => {
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ['-e', 'process.exit(42)'],
      inheritStdio: true,
    });

    expect(result.exitCode).toBe(42);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
