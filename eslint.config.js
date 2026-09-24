import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const reactRecommended = react.configs.flat.recommended;
const reactRuntime = react.configs.flat['jsx-runtime'];
const hooksRecommended = reactHooks.configs.flat.recommended;
const a11yRecommended = jsxA11y.flatConfigs.recommended;

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-server/**',
      'coverage/**',
      '.git/**',
      '.lighthouseci/**',
      'public/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      ...(reactRecommended.plugins ?? {}),
      ...(reactRuntime.plugins ?? {}),
      ...(hooksRecommended.plugins ?? {}),
      ...(a11yRecommended.plugins ?? {}),
    },
    rules: {
      ...(reactRecommended.rules ?? {}),
      ...(reactRuntime.rules ?? {}),
      ...(hooksRecommended.rules ?? {}),
      ...(a11yRecommended.rules ?? {}),
      // Existing RestaurantOS code uses runtime-shaped Firestore/API objects extensively.
      // Keep explicit-any as an allowed boundary while TypeScript strict checking remains
      // the authoritative type-safety gate.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/prop-types': 'warn',
      'react/display-name': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/img-redundant-alt': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
);
