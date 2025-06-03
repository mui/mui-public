import { includeIgnoreFile } from '@eslint/compat';
import { defineConfig, globalIgnores } from 'eslint/config';
import * as path from 'node:path';
import baseConfig from '@mui/infra/eslint';
import testConfig from '@mui/infra/eslint-test';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default defineConfig(
  includeIgnoreFile(path.join(dirname, '.gitignore')),
  includeIgnoreFile(path.join(dirname, '.eslintignore')),
  globalIgnores(['packages/mui-infra/src/eslint/material-ui/rules/*.test.*'], 'Global ignores'),
  {
    name: 'Base config',
    extends: baseConfig,
    settings: {
      'import/resolver': {
        typescript: {
          project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'import/prefer-default-export': 'off',
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  {
    files: [
      // matching the pattern of the test runner
      '**/*.test.?(c|m)[jt]s?(x)',
    ],
    extends: testConfig,
  },
  {
    files: ['**/*.mjs'],
    rules: {
      'import/extensions': ['error', 'ignorePackages'],
    },
  },
  {
    files: ['**/apps/**/*'],
    rules: {
      'import/no-relative-packages': 'off',
      'react/jsx-one-expression-per-line': 'off',
    },
  },
  {
    files: ['packages/bundle-size-checker/**/*'],
    rules: {
      'import/prefer-default-export': 'off',
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
