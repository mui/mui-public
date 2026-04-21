import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-xmlns-on-svg.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-xmlns-on-svg', rule, {
  valid: [
    '<svg width="16" height="16" />',
    '<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>',
    // xmlns on non-svg elements is out of scope
    '<div xmlns="http://www.w3.org/2000/svg" />',
    // xmlns on a nested element (e.g. foreignObject) is out of scope
    '<svg><foreignObject xmlns="http://www.w3.org/1999/xhtml" /></svg>',
  ],
  invalid: [
    {
      code: '<svg xmlns="http://www.w3.org/2000/svg" />',
      output: '<svg />',
      errors: [{ messageId: 'xmlnsOnSvg' }],
    },
    {
      code: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" />',
      output: '<svg width="16" height="16" />',
      errors: [{ messageId: 'xmlnsOnSvg' }],
    },
    {
      code: '<svg width="16" xmlns="http://www.w3.org/2000/svg" height="16" />',
      output: '<svg width="16" height="16" />',
      errors: [{ messageId: 'xmlnsOnSvg' }],
    },
    {
      code: '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" />',
      output: '<svg width="16" height="16" />',
      errors: [{ messageId: 'xmlnsOnSvg' }],
    },
    {
      code: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>',
      output: '<svg><path d="M0 0" /></svg>',
      errors: [{ messageId: 'xmlnsOnSvg' }],
    },
  ],
});
