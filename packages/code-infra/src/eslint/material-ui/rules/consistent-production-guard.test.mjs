import { afterAll, it, describe } from 'vitest';
import { RuleTester } from '@typescript-eslint/rule-tester';
import TSESlintParser from '@typescript-eslint/parser';
import rule from './consistent-production-guard.mjs';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: TSESlintParser,
  },
});

ruleTester.run('consistent-production-guard', rule, {
  valid: [
    // Should pass: Valid !== comparison with 'production'
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  console.log('dev');
}
      `,
    },
    // Should pass: Valid === comparison with 'production'
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  console.log('prod');
}
      `,
    },
    // Should pass: Reversed comparison (literal on left)
    {
      code: `
if ('production' !== process.env.NODE_ENV) {
  console.log('dev');
}
      `,
    },
    // Should pass: Reversed comparison with ===
    {
      code: `
if ('production' === process.env.NODE_ENV) {
  console.log('prod');
}
      `,
    },
    // Should pass: Code without process.env.NODE_ENV
    {
      code: `
const foo = 'bar';
if (foo === 'baz') {
  console.log('test');
}
      `,
    },
  ],
  invalid: [
    // Should fail: Comparing with 'development'
    {
      code: `
if (process.env.NODE_ENV === 'development') {
  console.log('dev');
}
      `,
      errors: [
        {
          messageId: 'invalidComparison',
          data: { comparedValue: 'development' },
        },
      ],
    },
    // Should fail: Comparing with 'test'
    {
      code: `
if (process.env.NODE_ENV !== 'test') {
  console.log('not test');
}
      `,
      errors: [
        {
          messageId: 'invalidComparison',
          data: { comparedValue: 'test' },
        },
      ],
    },
    // Should fail: Reversed comparison with 'development'
    {
      code: `
if ('development' === process.env.NODE_ENV) {
  console.log('dev');
}
      `,
      errors: [
        {
          messageId: 'invalidComparison',
          data: { comparedValue: 'development' },
        },
      ],
    },
    // Should fail: Non-static comparison (variable)
    {
      code: `
const env = 'production';
if (process.env.NODE_ENV !== env) {
  console.log('check');
}
      `,
      errors: [
        {
          messageId: 'invalidComparison',
          data: { comparedValue: 'non-literal' },
        },
      ],
    },
    // Should fail: Non-static comparison (reversed)
    {
      code: `
const env = 'production';
if (env === process.env.NODE_ENV) {
  console.log('check');
}
      `,
      errors: [
        {
          messageId: 'invalidComparison',
          data: { comparedValue: 'non-literal' },
        },
      ],
    },
    // Should fail: Invalid usage (function call)
    {
      code: `
foo(process.env.NODE_ENV);
      `,
      errors: [
        {
          messageId: 'invalidUsage',
        },
      ],
    },
    // Should fail: Invalid usage (assignment)
    {
      code: `
const env = process.env.NODE_ENV;
      `,
      errors: [
        {
          messageId: 'invalidUsage',
        },
      ],
    },
    // Should fail: Invalid usage (template literal)
    {
      code: `
const message = \`Environment: \${process.env.NODE_ENV}\`;
      `,
      errors: [
        {
          messageId: 'invalidUsage',
        },
      ],
    },
  ],
});
