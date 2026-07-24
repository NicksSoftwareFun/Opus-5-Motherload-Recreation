import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // World generation fills a million voxels and the suite does it several times
    // over to prove determinism. That is legitimately a few seconds of work and it
    // is worth testing, so the budget is raised rather than the coverage lowered.
    testTimeout: 30000,
  },
});
