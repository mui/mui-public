import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import { test } from 'vitest';
import rule from './disallow-active-element-as-key-event-target.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: { sourceType: 'module' },
  },
});

test('disallow-active-element-as-key-event-target', () => {
  ruleTester.run('disallow-active-element-as-key-event-target', rule, {
    valid: [
      "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyDown(getByRole('button'), { key: ' ' })",
      "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyDown(document.body, { key: 'Escape' })",
      "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyUp(document.body, { key: 'Tab' })",
    ],
    invalid: [
      {
        code: "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyUp(document.activeElement, { key: 'LeftArrow' })",
        errors: [
          {
            message:
              "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
            type: 'MemberExpression',
          },
        ],
      },
      {
        code: "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyDown(document.activeElement, { key: 'DownArrow' })",
        errors: [
          {
            message:
              "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
            type: 'MemberExpression',
          },
        ],
      },
      {
        code: "import { fireEvent } from 'any-path';\nfireEvent.keyDown(document.activeElement, { key: 'DownArrow' })",
        errors: [
          {
            message:
              "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
            type: 'MemberExpression',
          },
        ],
      },
      {
        code: "fireEvent.keyDown(document.activeElement, { key: 'DownArrow' })",
        errors: [
          {
            message:
              "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
            type: 'MemberExpression',
          },
        ],
      },
      {
        // test non-null assertion operator
        code: "import { fireEvent } from '@mui/internal-test-utils';\nfireEvent.keyUp(document.activeElement!, { key: 'LeftArrow' })",
        errors: [
          {
            message:
              "Don't use document.activeElement as a target for keyboard events. Prefer the actual element.",
            type: 'TSNonNullExpression',
          },
        ],
      },
    ],
  });
});
