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
    // Should pass: Function wrapped with !== production check
    {
      code: `
if (process.env.NODE_ENV !== 'production') {
  checkSlot(key, overrides[k]);
}
      `,
    },
    // Should pass: Function wrapped with === 'development' check (tree-shakes in production)
    {
      code: `
if (process.env.NODE_ENV === 'development') {
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
    // Should pass: Reversed comparison (literal on left)
    {
      code: `
if ('production' !== process.env.NODE_ENV) {
  checkSlot(key, value);
}
      `,
    },
    // Should pass: Function in else block when if checks for production
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  // production code
} else {
  checkSlot(key, value);
}
      `,
    },
    // Should pass: Nested if statement in else block
    {
      code: `
if (process.env.NODE_ENV === 'production') {
  // production code
} else {
  if (someCondition) {
    warnOnce('nested warning in else');
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
    // Should fail: Inside wrong conditional (no process.env.NODE_ENV)
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
    // Should fail: Inside else block of production check (!== 'production')
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
    // Should fail: In then block of === 'production' (would run in production!)
    {
      code: `
if (process.env.NODE_ENV === 'production') {
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
    // Should fail: !== 'test' doesn't reliably tree-shake
    {
      code: `
if (process.env.NODE_ENV !== 'test') {
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
    // Should fail: Non-static check doesn't tree-shake
    {
      code: `
const env = 'production';
if (process.env.NODE_ENV !== env) {
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
