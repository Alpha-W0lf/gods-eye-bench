import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
};

export default defineConfig(
  { ignores: ['.gev/', 'node_modules/', 'runs/', 'snapshots/', 'results/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules,
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // The TypeScript rule understands types; same options as above.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': rules['no-unused-vars'],
    },
  },
);
