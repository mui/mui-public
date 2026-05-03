import { defineConfig } from 'eslint/config';
import {
  createBaseConfig,
  createTestConfig,
  createDocsConfig,
  EXTENSION_TEST_FILE,
  EXTENSION_TS,
} from '@mui/internal-code-infra/eslint';
import nPlugin from 'eslint-plugin-n';
import { lintJavascriptDemoFocus } from '@mui/internal-docs-infra/pipeline/lintJavascriptDemoFocus';
import remarkConfig from './.remarkrc.mjs';

const config = defineConfig(
  createBaseConfig({
    baseDirectory: import.meta.dirname,
    markdown: true,
    consistentTypeImports: true,
  }),
  // eslint-plugin-mdx loads `.remarkrc.mjs` itself, but ESLint doesn't know
  // that file is a config dependency, so `--cache` doesn't invalidate when
  // it changes. Embedding the imported value in a setting puts its content
  // into the resolved-config hash, forcing cache invalidation on edits.
  { settings: { remarkConfig } },
  {
    files: [`**/*${EXTENSION_TS}`],
    plugins: {
      n: nPlugin,
    },
    rules: {
      // Not needed in this repo
      'compat/compat': 'off',
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      // Enforce using node: protocol for builtin modules
      'n/prefer-node-protocol': 'error',
      'mui/material-ui-no-empty-box': 'off',
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['tsconfig.json'],
        },
      },
    },
  },
  {
    files: [
      // Matching the pattern of the test runner
      `**/*${EXTENSION_TEST_FILE}`,
    ],
    extends: createTestConfig({ useMocha: false, useVitest: true }),
  },
  {
    files: [`packages/docs-infra/**/*${EXTENSION_TEST_FILE}`],
    rules: {
      // TODO @dav-is
      'vitest/no-conditional-expect': 'off',
    },
  },
  {
    files: ['docs/**/*'],
    extends: createDocsConfig(),
    settings: {
      'import/resolver': {
        typescript: {
          project: ['docs/tsconfig.json'],
        },
      },
    },
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['docs/app/**/demos/**/*.tsx', 'docs/app/**/demos/**/*.jsx'],
    plugins: {
      'docs-infra': { rules: { 'require-demo-focus': lintJavascriptDemoFocus } },
    },
    rules: {
      'docs-infra/require-demo-focus': ['error', { wrapReturn: true }],
    },
  },
  {
    files: [`apps/**/*${EXTENSION_TS}`],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['renovate/**/*.json'],
    language: 'json/jsonc',
  },
  {
    files: [`packages/babel-*/**/*${EXTENSION_TS}`],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: [`packages/bundle-size-checker/**/*${EXTENSION_TS}`],
    rules: {
      // Allow .js file extensions in import statements for ESM compatibility
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          js: 'always',
          mjs: 'always',
        },
      ],
    },
  },
);

export default config;
