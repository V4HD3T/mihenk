const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // The app logs through pino; a stray console.log in a request path is
      // almost always a debugging leftover. Scripts are exempted below.
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // CLI entry points and the standalone engine test harnesses talk to the
    // operator through stdout by design.
    files: ['scripts/**/*.js', 'test-exec.js', 'test-similarity.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
];
