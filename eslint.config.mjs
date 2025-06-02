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
      'import-x/resolver': {
        typescript: {
          project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'import-x/extensions': 'off',
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
      'import-x/extensions': ['error', 'ignorePackages'],
    },
  },
  {
    /**
     * Examples are for demonstration purposes and should not be considered a part of the library.
     * They don't contain ESLint setup, so we don't want them to contain ESLint directives
     * We do, however, want to keep the rules in place to ensure the examples are following
     * a reasonably similar code style as the library.
     */
    files: ['**/examples/**/*'],
    rules: {
      'no-console': 'off',
      'no-underscore-dangle': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/namespace': 'off',
      'import-x/extensions': 'off',
      'import-x/named': 'off',
      'import-x/no-duplicates': 'off',
      'import-x/no-named-as-default': 'off',
      'import-x/default': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/order': 'off',
      // Reset the default until https://github.com/jsx-eslint/eslint-plugin-react/issues/3672 is fixed.
      'react/jsx-no-target-blank': ['error', { allowReferrer: false }],
      'react/prop-types': 'off',
      'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
    },
  },
  {
    files: ['**/apps/**/*'],
    rules: {
      'import-x/no-relative-packages': 'off',
      'react/jsx-one-expression-per-line': 'off',
    },
  },
);
