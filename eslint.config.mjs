import { defineConfig } from 'eslint/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBaseConfig,
  createTestConfig,
  EXTENSION_TEST_FILE,
} from '@mui/internal-code-infra/eslint';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default defineConfig(
  {
    name: 'Base config',
    extends: createBaseConfig({
      baseDirectory: dirname,
    }),
    rules: {
      // No time for this
      'react/prop-types': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-autofocus': 'off',
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
    files: ['apps/**/*'],
    rules: {
      'react/jsx-one-expression-per-line': 'off',
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
