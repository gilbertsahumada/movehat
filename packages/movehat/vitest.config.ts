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
      // entries below ratchet specific files to ≥80% as M3 sub-PRs land.
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
        // M3.2 — core/runtime
        "src/runtime.ts":               { lines: 80, statements: 80, functions: 70, branches: 65 },
        "src/core/config.ts":           { lines: 80, statements: 80, functions: 80, branches: 70 },
        "src/core/AccountManager.ts":   { lines: 80, statements: 80, functions: 80, branches: 65 },
        // M3.3 — lifecycle managers
        "src/fork/manager.ts":          { lines: 80, statements: 80, functions: 75, branches: 60 },
        "src/node/LocalNodeManager.ts": { lines: 80, statements: 80, functions: 75, branches: 60 },
        // M3.4 — top-level commands
        // run.ts threshold intentionally below 80: the orchestrator's
        // "tsx-not-found" branch (lines 80-101) requires patching
        // `module.createRequire`, which fails with "Cannot redefine
        // property" in vitest's ESM context. propagateRunResultExit
        // (signal/exit-code forwarder) is at 100%; validation branches
        // covered; happy path covered. Remaining ~25% is the tsx
        // resolution fallback + final error exit — M4 integration covers.
        "src/commands/compile.ts":    { lines: 80, statements: 80, functions: 80,  branches: 65 },
        "src/commands/init.ts":       { lines: 80, statements: 80, functions: 75,  branches: 60 },
        "src/commands/run.ts":        { lines: 70, statements: 70, functions: 80,  branches: 65 },
        "src/commands/test.ts":       { lines: 80, statements: 80, functions: 75,  branches: 60 },
        "src/commands/test-move.ts":  { lines: 80, statements: 80, functions: 100, branches: 80 },
        "src/commands/update.ts":     { lines: 80, statements: 80, functions: 75,  branches: 50 },
      },
    },
    testTimeout: 10000,
  },
});
