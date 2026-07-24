import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    // Integration tests spawn the real Movement CLI and bind local
    // ports. Sequential execution prevents corruption of ~/.aptos
    // state and avoids port races.
    // The Vitest 4 forks pool uses a separate worker per file by default,
    // so the Movement local-node child of one file cannot bleed its port
    // (8080) into the next file's bind. Files still execute
    // sequentially because `fileParallelism: false` serializes them —
    // concurrent local nodes on the same host would still race.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // No coverage block — integration tests are correctness/contract
    // tests, not coverage drivers. The unit suite (vitest.config.ts)
    // owns the per-file thresholds.
  },
});
