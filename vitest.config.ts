import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/harness.ts'],
    coverage: { include: ['src/**'], exclude: ['src/services/*/openapi.d.ts'] },
  },
});
