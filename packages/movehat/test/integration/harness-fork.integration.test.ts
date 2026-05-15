import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Harness } from '../../src/index.js';
import { moveV1Dir } from './helpers/fixture-paths.js';

const integrationDir = dirname(fileURLToPath(import.meta.url));

/**
 * Read-only fork-mode exercise. Skipped when `MOVEMENT_RPC_URL` is
 * unset so the suite stays self-contained for local runs that don't
 * have testnet credentials. CI sets the env in `.github/workflows/ci.yml`.
 */
const RUN_FORK = Boolean(process.env.MOVEMENT_RPC_URL);
const network = process.env.MOVEHAT_NETWORK ?? 'testnet';

describe.skipIf(!RUN_FORK)('Harness.createFork — read-only against testnet', () => {
  let harness: Harness;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(integrationDir);
    harness = await Harness.createFork(network);
  }, 120_000);

  afterAll(async () => {
    if (harness) await harness.cleanup();
    if (originalCwd) process.chdir(originalCwd);
  });

  it('createFork returns a fork-mode harness bound to a local fork runtime', () => {
    expect(harness).toBeDefined();
    expect(harness.mode).toBe('fork');
    expect(harness.runtime).toBeDefined();
    // The fork is served by a local proxy; the runtime's `network.name`
    // is the local fork server identifier, not the upstream `testnet`.
    expect(harness.runtime.network.rpc).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
  });

  it('deployCodeObject throws in fork mode (read-only enforcement)', async () => {
    // Synchronous-style assertion: `Harness.deployCodeObject` checks
    // `this.mode === 'fork'` before any CLI call, so this rejects
    // without touching the network. View-function reads against the
    // fork are skipped — the fork server doesn't expose
    // `/accounts/<addr>/module/` endpoints, so SDK ABI lookups raise
    // `endpoint_not_found` (see TESTING.md).
    await expect(
      harness.deployCodeObject({
        moduleName: 'counter',
        addressName: 'integration_counter',
        packageDir: moveV1Dir,
      }),
    ).rejects.toThrow(/fork/i);
  });
});
