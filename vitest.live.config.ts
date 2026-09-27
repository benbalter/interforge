import { defineConfig } from 'vitest/config';

// Live tests talk to real forges, so they run separately (and without msw).
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
    // Show the spec-mismatch summary even when every test passes.
    silent: false,
  },
});
