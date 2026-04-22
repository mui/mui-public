import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './blanks-around-tables.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('blanks-around-tables', rule, {
  valid: [
    `Some text.

| a   | b   |
| :-- | :-- |
| 1   | 2   |

More text.
`,
    `| a   | b   |
| :-- | :-- |
| 1   | 2   |
`,
  ],
  invalid: [
    {
      code: `Before

| a   | b   |
| :-- | :-- |
| 1   | 2   |
## Heading right after
`,
      errors: [{ messageId: 'missingBlankAfter' }],
    },
  ],
});
