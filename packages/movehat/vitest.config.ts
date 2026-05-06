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
      // Aligned with CI gate (.github/workflows/ci.yml). Raise as tests grow.
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
      },
    },
    testTimeout: 10000,
  },
});
