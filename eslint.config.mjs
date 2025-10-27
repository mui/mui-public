import { defineConfig } from 'eslint/config';
import {
  createBaseConfig,
  createTestConfig,
  EXTENSION_TEST_FILE,
  EXTENSION_TS,
} from '@mui/internal-code-infra/eslint';
import nPlugin from 'eslint-plugin-n';

export default defineConfig(
  createBaseConfig({ baseDirectory: import.meta.dirname }),
  {
    files: [`**/*${EXTENSION_TS}`],
    plugins: {
      n: nPlugin,
    },
    rules: {
      // not needed in this repo
      'compat/compat': 'off',
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      // Enforce using node: protocol for builtin modules
      'n/prefer-node-protocol': 'error',
      'material-ui/no-empty-box': 'off',
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
      // matching the pattern of the test runner
      `**/*${EXTENSION_TEST_FILE}`,
    ],
    extends: createTestConfig(),
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
