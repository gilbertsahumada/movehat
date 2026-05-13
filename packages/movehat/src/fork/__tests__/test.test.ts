import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, viewForkResource } from '../test.js';
import type { ChildProcessAdapter, RunResult } from '../../utils/childProcessAdapter.js';

/**
 * Guards the exitCode-failure path that CodeRabbit flagged on PR #100:
 * before this hardening, an `aptos` command that exited non-zero with a
 * stderr containing the word "Success" (or no stderr at all) could slip
 * past the stderr-defense check in `snapshot`, and a non-JSON stderr from
 * `view-resource` produced a cryptic JSON parse error instead of the
 * actual aptos failure.
 */
describe('fork/test — exitCode failure paths', () => {
  let tmpCwd: string;
  let origCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), 'movehat-fork-test-'));
    origCwd = process.cwd();
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    try {
      process.chdir(origCwd);
    } finally {
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  function adapterReturning(result: RunResult): ChildProcessAdapter {
    return {
      async run() {
        return result;
      },
      spawn() {
        throw new Error('spawn not used in fork/test failure-path tests');
      },
    };
  }

  it("snapshot throws on non-zero exit even when stderr contains 'Success'", async () => {
    // The pre-fix edge case: aptos exits 1, stderr says
    // "Failed: Success criteria not met" → the stderr.includes('Success')
    // gate returned false-positive ok, and a stale directory from a prior
    // run would mask the failure entirely.
    const adapter = adapterReturning({
      exitCode: 1,
      stdout: '',
      stderr: 'Failed: Success criteria not met for snapshot init',
    });

    await expect(snapshot({ name: 'edge', adapter })).rejects.toThrow(
      /Success criteria not met/
    );
  });

  it('snapshot still throws when a stale directory from a prior run exists (the full edge case)', async () => {
    // The pre-fix combined edge case: aptos exits non-zero, stderr happens
    // to contain "Success" (so the stderr.includes('Success') gate would
    // false-positive), AND the snapshot directory already exists from a
    // previous successful run (so the existsSync check would false-positive
    // too). The new exitCode check fires first and throws regardless.
    const stalePath = join(tmpCwd, '.movehat', 'snapshots', 'stale');
    mkdirSync(stalePath, { recursive: true });
    writeFileSync(join(stalePath, 'config.json'), '{}');

    const adapter = adapterReturning({
      exitCode: 1,
      stdout: '',
      stderr: 'Failed but Success was nearby',
    });

    await expect(
      snapshot({ name: 'stale', path: stalePath, adapter })
    ).rejects.toThrow(/Failed but Success was nearby/);
  });

  it('viewForkResource throws on non-zero exit with non-JSON stderr (informative message)', async () => {
    // Pre-fix the failure surfaced as "Unexpected token ..." from
    // JSON.parse, which obscured the actual aptos error.
    const adapter = adapterReturning({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: session not found',
    });

    await expect(
      viewForkResource('/nonexistent/session', '0x1', '0x1::coin::CoinStore', {
        adapter,
      })
    ).rejects.toThrow(/session not found/);
  });
});
