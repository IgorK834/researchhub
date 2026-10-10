import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import css from '@eslint/css';

/**
 * ESLint 9 flat config.
 *
 * Parser: `@babel/eslint-parser`, reusing this project's babel.config.cjs. ESLint therefore
 * parses exactly what Webpack compiles, and there is no second TypeScript program to keep in
 * sync. `typescript-eslint` is deliberately not used: TypeScript 7's npm package no longer
 * exports the legacy compiler API that its parser requires. Type correctness is enforced
 * separately by `npm run typecheck` (`tsc --noEmit`), which runs in `npm run build` too.
 *
 * See docs/development/frontend-tooling.md.
 */
export default [
  {
    ignores: ['dist/**', 'dist-canvas-legacy/**', 'node_modules/**', 'coverage/**'],
  },

  { ...js.configs.recommended, files: ['**/*.{js,cjs,mjs,jsx,ts,tsx}'] },

  {
    files: ['src/**/*.css'],
    plugins: { css },
    language: 'css/css',
    rules: {
      ...css.configs.recommended.rules,
      // Definitions live in tokens.css; a contract test catches missing references.
      'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
    },
  },

  {
    files: ['src/**/*.d.ts'],
    // Babel's scope model conflates separate ambient module declarations.
    rules: { 'no-redeclare': 'off' },
  },
  {
    // Exact MIT-licensed Tiptap baseline, now emitted as an external stylesheet for CSP.
    files: ['src/styles/editor.css'],
    rules: { 'css/no-important': 'off', 'css/use-baseline': 'off' },
  },

  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: true,
        babelOptions: {
          cwd: import.meta.dirname,
        },
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat.recommended.rules,

      // TypeScript's own checker covers undefined identifiers and unused locals with better
      // precision than ESLint can without type information, and it understands type-only
      // imports and TSX generics. Leaving these on produces false positives on valid TS.
      'no-unused-vars': 'off',
      'no-undef': 'off',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Node-based tooling files use CommonJS and Node globals.
  {
    files: ['*.cjs', 'e2e/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },

  // Must stay last: switches off stylistic rules that would fight Prettier.
  prettierConfig,
];
