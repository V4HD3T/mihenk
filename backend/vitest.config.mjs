import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Loaded before any test file, so the app sees a valid test configuration
    // the moment it is imported.
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // Test files run one at a time.
    //
    // Both integration suites rebuild the schema from scratch in beforeAll
    // against the same database. Run in parallel, one suite drops the tables
    // the other is midway through using - which showed up as an intermittent
    // failure that passed on the next run. An intermittently red CI is worse
    // than a slightly slower one, and the whole suite finishes in ~2s anyway.
    fileParallelism: false,
  },
});
