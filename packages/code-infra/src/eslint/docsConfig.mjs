import nextjs from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createDocsConfig() {
  return defineConfig(nextjs.flatConfig.recommended, {
    settings: {
      next: {
        rootDir: 'docs',
      },
    },
    files: ['**/*.js', '**/*.mjs', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    rules: {
      'compat/compat': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
    },
  });
}
