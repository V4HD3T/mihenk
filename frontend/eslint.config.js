import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * The frontend went nine releases without a linter. v0.1.0 then shipped a fix
 * for twenty form labels that were never associated with their inputs - a
 * defect `jsx-a11y/label-has-associated-control` reports in under a second.
 * That rule is the reason this file exists; the rest is the same house style
 * the backend already enforces.
 *
 * Pinned to the ESLint 9 line while the backend is on 10: neither
 * eslint-plugin-react nor eslint-plugin-jsx-a11y declares support for 10 yet,
 * and dropping the accessibility rules to unify the major would give up the
 * only thing that has actually caught a bug here.
 */
export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Matches the backend config so the two halves read the same way.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',

      // Errors reach the user through rendered state, not devtools. A stray
      // console.* is a debugging leftover.
      'no-console': 'error',

      // The v0.1.0 bug class: a <label> that names no control.
      'jsx-a11y/label-has-associated-control': [
        'error',
        { assert: 'either', depth: 3 },
      ],

      // The mirror image - an input with no label at all - is deliberately
      // left to axe in the test suite rather than to
      // `jsx-a11y/control-has-associated-label`. That rule cannot follow a
      // htmlFor/id pair across elements, so it reports every correctly
      // labelled field in the app; axe resolves the association properly and
      // already runs on each page the tests render.
      'jsx-a11y/control-has-associated-label': 'off',

      // `<ProtectedRoute role="teacher">` is an authorization prop on one of
      // our own components, not an ARIA role. Without this the rule reports
      // every guarded route; renaming the prop to satisfy a linter that has
      // misread it would be the wrong way round.
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],

      // The app declares its own prop contracts through usage; prop-types
      // would be ceremony on a codebase this size with no public components.
      'react/prop-types': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,jsx}', '*.config.js', 'vitest.config.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
];
