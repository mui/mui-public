import nextjs from '@next/eslint-plugin-next';
import * as tseslint from 'typescript-eslint';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createDocsConfig() {
  return /** @type {import('eslint').Linter.Config[]} */ (
    tseslint.config(nextjs.flatConfig.recommended, {
      settings: {
        next: {
          rootDir: 'docs',
        },
      },
      rules: {
        'jsx-a11y/anchor-is-valid': 'off',
        'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
      },
    })
  );
}
