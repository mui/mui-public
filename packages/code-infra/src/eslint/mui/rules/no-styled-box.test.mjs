import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './no-styled-box.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-styled-box', rule, {
  valid: [
    `
import { styled } from '@mui/system';
styled('div');
`,
    `
import { styled } from '@mui/system';
styled('div', {});
`,
  ],
  invalid: [
    {
      code: `
import { styled } from '@mui/system';
import Box from '@mui/material/Box';

const foo = styled(Box)({
  color: 'red',
});
`,
      errors: [
        {
          messageId: 'noBox',
        },
      ],
      output: `
import { styled } from '@mui/system';
import Box from '@mui/material/Box';

const foo = styled('div')({
  color: 'red',
});
`,
    },
    {
      code: `
import { styled } from '@mui/system';
import Box from '@mui/material/Box';

const foo = styled(Box, {})({
  color: 'red',
});
`,
      errors: [
        {
          messageId: 'noBox',
        },
      ],
      output: `
import { styled } from '@mui/system';
import Box from '@mui/material/Box';

const foo = styled('div', {})({
  color: 'red',
});
`,
    },
  ],
});
