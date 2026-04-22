import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './no-space-in-links.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('no-space-in-links', rule, {
  valid: [`[link text](https://example.com)\n`, `Some [inline](https://example.com) text.\n`],
  invalid: [
    {
      code: `[ link text ](https://example.com)\n`,
      errors: [{ messageId: 'spaceInLink' }],
    },
    {
      code: `[trailing ](https://example.com)\n`,
      errors: [{ messageId: 'spaceInLink' }],
    },
  ],
});
