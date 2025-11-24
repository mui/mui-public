import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-restricted-imports.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaVersion: 2015,
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-restricted-imports', rule, {
  valid: [
    // No configuration - should allow everything
    {
      code: "import foo from 'foo';",
      options: [[]],
    },
    // Pattern doesn't match
    {
      code: "import foo from 'foo';",
      options: [[{ pattern: 'bar' }]],
    },
    {
      code: "import foo from '@mui/material';",
      options: [[{ pattern: '@mui/material/*' }]],
    },
    {
      code: "import { Box } from '@mui/material';",
      options: [[{ pattern: '@mui/material/Box' }]],
    },
    // Glob patterns - no match
    {
      code: "import foo from '@mui/material';",
      options: [[{ pattern: '@mui/*/internal/**' }]],
    },
    {
      code: "import foo from 'react';",
      options: [[{ pattern: '**/*.css' }]],
    },
    {
      code: "const foo = require('foo');",
      options: [[{ pattern: 'bar' }]],
    },
  ],
  invalid: [
    // Simple pattern match
    {
      code: "import foo from 'foo';",
      options: [[{ pattern: 'foo' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: 'foo',
            pattern: 'foo',
            customMessage: '',
          },
        },
      ],
    },
    // Glob pattern with wildcard
    {
      code: "import Box from '@mui/material/Box';",
      options: [[{ pattern: '@mui/material/*' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: '@mui/material/Box',
            pattern: '@mui/material/*',
            customMessage: '',
          },
        },
      ],
    },
    // Deep glob pattern
    {
      code: "import foo from '@mui/material/internal/utils';",
      options: [[{ pattern: '@mui/*/internal/**' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: '@mui/material/internal/utils',
            pattern: '@mui/*/internal/**',
            customMessage: '',
          },
        },
      ],
    },
    // Custom message
    {
      code: "import foo from 'foo';",
      options: [[{ pattern: 'foo', message: 'Use bar instead.' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: 'foo',
            pattern: 'foo',
            customMessage: ' Use bar instead.',
          },
        },
      ],
    },
    // Multiple patterns - first match wins
    {
      code: "import foo from '@mui/material/Box';",
      options: [
        [
          { pattern: '@mui/material/*', message: 'First message.' },
          { pattern: '@mui/material/Box', message: 'Second message.' },
        ],
      ],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: '@mui/material/Box',
            pattern: '@mui/material/*',
            customMessage: ' First message.',
          },
        },
      ],
    },
    // CommonJS require
    {
      code: "const foo = require('foo');",
      options: [[{ pattern: 'foo' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: 'foo',
            pattern: 'foo',
            customMessage: '',
          },
        },
      ],
    },
    // Named imports
    {
      code: "import { Box } from '@mui/material/Box';",
      options: [[{ pattern: '@mui/material/*' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: '@mui/material/Box',
            pattern: '@mui/material/*',
            customMessage: '',
          },
        },
      ],
    },
    // Namespace imports
    {
      code: "import * as Material from '@mui/material/Box';",
      options: [[{ pattern: '@mui/material/*' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: '@mui/material/Box',
            pattern: '@mui/material/*',
            customMessage: '',
          },
        },
      ],
    },
    // File extensions
    {
      code: "import styles from './styles.css';",
      options: [[{ pattern: './**/*.css' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: './styles.css',
            pattern: './**/*.css',
            customMessage: '',
          },
        },
      ],
    },
    // Multiple restricted patterns
    {
      code: "import foo from 'foo/bar/baz';",
      options: [[{ pattern: 'foo/**', message: 'Do not import from foo internals.' }]],
      errors: [
        {
          messageId: 'restrictedImport',
          data: {
            importSource: 'foo/bar/baz',
            pattern: 'foo/**',
            customMessage: ' Do not import from foo internals.',
          },
        },
      ],
    },
  ],
});
