import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './straight-quotes.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('straight-quotes', rule, {
  valid: [`# Title\n\nA paragraph with "straight" and 'simple' quotes.\n`],
  invalid: [
    {
      code: `# Title\n\nA paragraph with “curly” quotes.\n`,
      errors: [
        { messageId: 'wrongQuotes', line: 3, column: 18 },
        { messageId: 'wrongQuotes', line: 3, column: 24 },
      ],
    },
    {
      code: `Use ‘single’ curly quotes too.\n`,
      errors: [
        { messageId: 'wrongQuotes', line: 1, column: 5 },
        { messageId: 'wrongQuotes', line: 1, column: 12 },
      ],
    },
  ],
});
