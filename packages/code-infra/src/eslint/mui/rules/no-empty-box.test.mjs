import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-empty-box.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-empty-box', rule, {
  valid: ['<Box sx={{ width: 1 }}>Foo</Box>', '<Box sx={{ width: 1 }} />', '<Box {...props} />'],
  invalid: [
    {
      code: '<Box>Foo</Box>',
      errors: [
        {
          messageId: 'emptyBox',
          data: {
            component: 'div',
          },
        },
      ],
    },
    {
      code: '<Box component="span">Foo</Box>',
      errors: [
        {
          messageId: 'emptyBox',
          data: {
            component: 'span',
          },
        },
      ],
    },
  ],
});
