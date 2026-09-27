import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**', 'node_modules/**'],
    setupFiles: ['test/support/harness.ts'],
    coverage: { include: ['src/**'], exclude: ['src/services/*/openapi.ts'] },
  },
});
