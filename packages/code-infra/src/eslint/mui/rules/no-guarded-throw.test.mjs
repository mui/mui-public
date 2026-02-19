import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-guarded-throw.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
  },
});

ruleTester.run('no-guarded-throw', rule, {
  valid: [
    // Should pass: Unconditional throw
    {
      code: `
throw new Error('Something went wrong');
      `,
    },
    // Should pass: Throw inside a non-NODE_ENV conditional
    {
      code: `
if (value == null) {
  throw new TypeError('value is required');
}
      `,
    },
    // Should pass: Throw inside a catch block (no NODE_ENV guard)
    {
      code: `
try {
  doSomething();
} catch (error) {
  throw new Error('Failed');
}
      `,
    },
  ],
  invalid: [
    // Should fail: Throw inside !== 'production' guard
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  throw new Error('Dev-only error');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Throw inside === 'production' guard
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  throw new Error('Prod-only error');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Throw in else block of === 'production' check
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  // production path
} else {
  throw new Error('Non-production error');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Throw nested inside NODE_ENV guard
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  if (value == null) {
    throw new TypeError('value is required');
  }
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Reversed comparison (literal on left)
    {
      code: `
if ('production' !== process.env.NODE_ENV) {
  throw new Error('Dev-only error');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Throw in loop inside NODE_ENV guard
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  for (const item of items) {
    throw new Error('Invalid item');
  }
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: NODE_ENV combined with other conditions using &&
    {
      code: `
if (process.env.NODE_ENV !== 'production' && value == null) {
  throw new TypeError('value is required');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: NODE_ENV combined with other conditions using ||
    {
      code: `
if (condition || process.env.NODE_ENV === 'test') {
  throw new Error('Test or condition error');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: Unary not on process.env.NODE_ENV
    {
      code: `
if (!process.env.NODE_ENV) {
  throw new Error('NODE_ENV not set');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
    // Should fail: NODE_ENV passed to a function
    {
      code: `
if (fn(process.env.NODE_ENV)) {
  throw new Error('Function check failed');
}
      `,
      errors: [{ messageId: 'guardedThrow' }],
    },
  ],
});
