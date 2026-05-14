import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['src/templates/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/templates/**',
        'src/index.ts',
        'src/cli.ts',
        'src/types/**',
      ],
      // Global floor stays at 15 until M3.5 flips it to 80. Per-target
      // entries below ratchet specific files to ≥80% as M3 sub-PRs land
      // (M3.2 = runtime/config/AccountManager; M3.3 = fork/manager,
      // node/LocalNodeManager).
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
        "src/runtime.ts":               { lines: 80, statements: 80, functions: 70, branches: 65 },
        "src/core/config.ts":           { lines: 80, statements: 80, functions: 80, branches: 70 },
        "src/core/AccountManager.ts":   { lines: 80, statements: 80, functions: 80, branches: 65 },
        "src/fork/manager.ts":          { lines: 80, statements: 80, functions: 75, branches: 60 },
        "src/node/LocalNodeManager.ts": { lines: 80, statements: 80, functions: 75, branches: 60 },
      },
    },
    testTimeout: 10000,
  },
});
