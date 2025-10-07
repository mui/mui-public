import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './require-dev-wrapper.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
  },
});

ruleTester.run('require-dev-wrapper', rule, {
  valid: [
    // Should pass: Function wrapped with correct production check
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  checkSlot(key, overrides[k]);
}
      `,
    },
    // Should pass: Function wrapped in a for loop inside production check
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  for (key in slots) {
    checkSlot(key, overrides[k]);
  }
}
      `,
    },
    // Should pass: Other functions not in the list
    {
      code: `
otherFunction('hello');
      `,
    },
    // Should pass: warnOnce wrapped correctly
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  warnOnce('Some warning message');
}
      `,
    },
    // Should pass: warn wrapped correctly
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  warn('Some warning message');
}
      `,
    },
    // Should pass: Multiple statements in production check
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  const message = 'Warning';
  warn(message);
  checkSlot(key, value);
}
      `,
    },
    // Should pass: Nested blocks
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  if (someCondition) {
    warnOnce('nested warning');
  }
}
      `,
    },
  ],
  invalid: [
    // Should fail: checkSlot without production check
    {
      code: `
checkSlot(key, overrides[k]);
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'checkSlot' },
        },
      ],
    },
    // Should fail: Wrong condition (=== instead of !==)
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  checkSlot(key, overrides[k]);
}
      `,
      errors: [
        {
          messageId: 'wrongCondition',
          data: { functionName: 'checkSlot' },
        },
      ],
    },
    // Should fail: warnOnce without production check
    {
      code: `
warnOnce('Some warning');
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'warnOnce' },
        },
      ],
    },
    // Should fail: warn without production check
    {
      code: `
warn('Some warning');
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'warn' },
        },
      ],
    },
    // Should fail: Multiple unwrapped calls
    {
      code: `
checkSlot(key, value);
warn('Warning message');
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'checkSlot' },
        },
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'warn' },
        },
      ],
    },
    // Should fail: Inside wrong conditional
    {
      code: `
if (someOtherCondition) {
  checkSlot(key, value);
}
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'checkSlot' },
        },
      ],
    },
    // Should fail: Inside else block of production check
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  // ok
} else {
  checkSlot(key, value);
}
      `,
      errors: [
        {
          messageId: 'missingDevWrapper',
          data: { functionName: 'checkSlot' },
        },
      ],
    },
  ],
});
