import { defineConfig } from 'eslint/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBaseConfig,
  createTestConfig,
  EXTENSION_TEST_FILE,
  EXTENSION_TS,
} from '@mui/internal-code-infra/eslint';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// List of Node.js builtin modules that should use node: protocol
const builtinModules = [
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

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
      '@typescript-eslint/triple-slash-reference': 'off',
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
  {
    name: 'Node.js builtin modules protocol enforcement',
    rules: {
      // Enforce using node: protocol for builtin modules
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.map((module) => ({
            name: module,
            message: `Import '${module}' using the 'node:' protocol instead. Use 'node:${module}' to make it clear this is a Node.js builtin module.`,
          })),
        },
      ],
    },
  },
);
