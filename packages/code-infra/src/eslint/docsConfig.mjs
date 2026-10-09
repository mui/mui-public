import nextjs from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import { EXTENSION_TS } from './extensions.mjs';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createDocsConfig() {
  /**
   * @type {any}
   */
  const nextjsAlias = nextjs;

  // `nextjs.flatConfig.recommended` for Next.js v15 supports.
  // `nextjs.configs.recommended` for Next.js v16 support
  // See https://github.com/vercel/next.js/pull/83763 for the breaking change details
  // TODO Migrate to Next.js 16+ so we can remove `nextjs.flatConfig`.
  const recommendedConfig = nextjs.flatConfig
    ? nextjsAlias.flatConfig.recommended
    : nextjsAlias.configs.recommended;

  return defineConfig(
    recommendedConfig,
    {
      settings: {
        next: {
          rootDir: 'docs',
        },
      },
      files: [`**/*${EXTENSION_TS}`],
      rules: {
        'compat/compat': 'off',
        'jsx-a11y/anchor-is-valid': 'off',
        'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
      },
    },
    {
      // Build configuration and maintenance scripts aren't documentation examples
      // and are often intentionally outside the docs TypeScript project.
      files: [`**/*${EXTENSION_TS}`],
      ignores: ['**/*.config.*', '**/scripts/**'],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: process.cwd(),
        },
      },
      rules: {
        '@typescript-eslint/no-deprecated': 'error',
      },
    },
  );
}
