// Flat config (ESLint 10). Drafted by the local LLM, adjusted: @eslint/js
// baseline added, svelte TS-parser block scoped to *.svelte, ignores given
// **/ prefixes (bare names only match at the repo root in flat config).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/build/',
      '**/.svelte-kit/',
      '**/coverage/',
      '**/*.db',
      'scripts/',
      'backups/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
    rules: {
      'svelte/no-at-html-tags': 'warn',
      // TS checks identifiers inside <script lang="ts">; core no-undef
      // false-positives on browser globals here.
      'no-undef': 'off',
      // Existing-codebase floor: real best practices, but bulk-fixing them is
      // behavior-affecting churn (keyed each changes list reconciliation) or
      // stylistic for this static-adapter SPA. Warn now, ratchet later.
      'svelte/require-each-key': 'warn',
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/prefer-svelte-reactivity': 'warn',
    },
  }
);
