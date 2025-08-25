import { defineConfig } from 'eslint/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBaseConfig,
  createTestConfig,
  EXTENSION_TEST_FILE,
  EXTENSION_TS,
} from '@mui/internal-code-infra/eslint';
import nPlugin from 'eslint-plugin-n';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default defineConfig(
  {
    name: 'Base config',
    extends: createBaseConfig({
      baseDirectory: dirname,
    }),
    plugins: {
      n: nPlugin,
    },
    rules: {
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      // Enforce using node: protocol for builtin modules
      'n/prefer-node-protocol': 'error',
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
    files: [`apps/**/*.${EXTENSION_TS}`],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: [`packages/babel-*/**/*.${EXTENSION_TS}`],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['packages/bundle-size-checker/**/*'],
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
