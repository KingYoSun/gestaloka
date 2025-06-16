import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...Object.fromEntries(
          Object.entries(globals.browser).map(([key, value]) => [key.trim(), value])
        ),
        ...Object.fromEntries(
          Object.entries(globals.node).map(([key, value]) => [key.trim(), value])
        ),
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-interface': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off', // TypeScriptがこれを処理するため
    },
  },
  {
    files: ['src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(
          Object.entries(globals.jest).map(([key, value]) => [key.trim(), value])
        ),
      },
    },
  },
  {
    ignores: ['dist', 'node_modules', '.eslintrc.cjs', 'vite.config.ts', '*.config.js', '*.config.ts'],
  },
];