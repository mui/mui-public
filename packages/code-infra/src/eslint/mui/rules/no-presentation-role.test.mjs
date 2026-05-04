import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-presentation-role.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-presentation-role', rule, {
  valid: [
    '<div role="none" />',
    '<div role="button" />',
    '<div />',
    '<div role={presentation} />',
  ],
  invalid: [
    {
      code: '<div role="presentation" />',
      errors: [{ messageId: 'noPresentation' }],
      output: '<div role="none" />',
    },
    {
      code: "<div role={'presentation'} />",
      errors: [{ messageId: 'noPresentation' }],
      output: '<div role="none" />',
    },
    {
      code: '<table role="presentation"><tr><td /></tr></table>',
      errors: [{ messageId: 'noPresentation' }],
      output: '<table role="none"><tr><td /></tr></table>',
    },
  ],
});
