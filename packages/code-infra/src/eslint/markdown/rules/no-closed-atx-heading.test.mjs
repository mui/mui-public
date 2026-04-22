import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './no-closed-atx-heading.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('no-closed-atx-heading', rule, {
  valid: [`# Heading\n`, `## Heading with hash#in the middle\n`, `### Heading ending with hash#\n`],
  invalid: [
    {
      code: `## Heading ##\n`,
      errors: [{ messageId: 'closedAtx' }],
    },
    {
      code: `### Spaces  ###\n`,
      errors: [{ messageId: 'closedAtx' }],
    },
  ],
});
