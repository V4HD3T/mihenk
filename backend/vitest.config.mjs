import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Loaded before any test file, so the app sees a valid test configuration
    // the moment it is imported.
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
  },
});
