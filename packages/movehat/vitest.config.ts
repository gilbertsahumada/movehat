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
      // Global floor + per-file map. Per-file entries below ratchet the
      // 16 critical modules to ≥80%; the global floor is set below 80
      // because helper/UI/setup modules outside that list still sit at
      // 0–30% (banner, move-tests, setup, version-check, npm-registry,
      // ui/spinner, etc). The per-file gate is the canonical correctness
      // signal — regressions on listed files fail CI before they fail
      // the (more lenient) global gate.
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 55,
        statements: 70,
        // core/runtime
        "src/runtime.ts":               { lines: 80, statements: 80, functions: 70, branches: 65 },
        "src/core/config.ts":           { lines: 80, statements: 80, functions: 80, branches: 70 },
        "src/core/AccountManager.ts":   { lines: 80, statements: 80, functions: 80, branches: 65 },
        // lifecycle managers
        "src/fork/manager.ts":          { lines: 80, statements: 80, functions: 75, branches: 60 },
        "src/node/LocalNodeManager.ts": { lines: 80, statements: 80, functions: 75, branches: 60 },
        // top-level commands
        // run.ts threshold intentionally below 80: the orchestrator's
        // "tsx-not-found" branch (lines 80-101) requires patching
        // `module.createRequire`, which fails with "Cannot redefine
        // property" in vitest's ESM context. propagateRunResultExit
        // (signal/exit-code forwarder) is at 100%; validation branches
        // covered; happy path covered. Remaining ~25% is the tsx
        // resolution fallback + final error exit (covered by integration).
        "src/commands/compile.ts":    { lines: 80, statements: 80, functions: 80,  branches: 65 },
        "src/commands/init.ts":       { lines: 80, statements: 80, functions: 75,  branches: 60 },
        "src/commands/run.ts":        { lines: 70, statements: 70, functions: 80,  branches: 65 },
        "src/commands/test.ts":       { lines: 80, statements: 80, functions: 75,  branches: 60 },
        "src/commands/test-move.ts":  { lines: 80, statements: 80, functions: 100, branches: 80 },
        "src/commands/update.ts":     { lines: 80, statements: 80, functions: 75,  branches: 50 },
        // fork commands
        "src/commands/fork/create.ts":        { lines: 80, statements: 80, functions: 75, branches: 60 },
        "src/commands/fork/fund.ts":          { lines: 80, statements: 80, functions: 80, branches: 70 },
        "src/commands/fork/list.ts":          { lines: 80, statements: 80, functions: 75, branches: 60 },
        // serve.ts function threshold lowered to 25 because the sigint/
        // sigterm shutdown handlers are registered via `process.once` and
        // never fire during the test run. Lines/statements remain at 80.
        "src/commands/fork/serve.ts":         { lines: 80, statements: 80, functions: 25, branches: 65 },
        "src/commands/fork/view-resource.ts": { lines: 80, statements: 80, functions: 80, branches: 70 },
      },
    },
    testTimeout: 10000,
  },
});
