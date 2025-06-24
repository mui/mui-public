/**
 * This is an export on a separate path so that users of the package
 * can use this config optionally by installing the `@next/eslint-plugin-next` package.
 */
import nextjs from '@next/eslint-plugin-next';
import * as tselint from 'typescript-eslint';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createDocsConfig() {
  return tselint.config(nextjs.flatConfig.recommended, {
    settings: {
      next: {
        rootDir: 'docs',
      },
    },
    rules: {
      'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
    },
  });
}
