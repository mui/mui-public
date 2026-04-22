import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './table-alignment.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('table-alignment', rule, {
  valid: [
    `| Version | Supported |
| ------: | :-------- |
|       1 | yes       |
`,
    `| Left | Center | Right |
| :--- | :----: | ----: |
| a    | b      | c     |
`,
  ],
  invalid: [
    {
      code: `| Version | Supported |
| ------- | --------- |
| 1       | yes       |
`,
      errors: [{ messageId: 'missingAlignment' }, { messageId: 'missingAlignment' }],
    },
    {
      code: `| Left | Unaligned |
| :--- | --------- |
| a    | b         |
`,
      errors: [{ messageId: 'missingAlignment' }],
    },
  ],
});
