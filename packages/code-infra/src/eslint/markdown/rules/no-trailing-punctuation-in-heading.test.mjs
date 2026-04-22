import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './no-trailing-punctuation-in-heading.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('no-trailing-punctuation-in-heading', rule, {
  valid: [
    `# Clean heading\n`,
    `## Question?\n`,
    // Trailing closing ATX hashes are tolerated by this rule (handled elsewhere).
    `## Heading ##\n`,
  ],
  invalid: [
    {
      code: `# Heading with period.\n`,
      errors: [{ messageId: 'trailingPunctuation' }],
    },
    {
      code: `## Another!\n`,
      errors: [{ messageId: 'trailingPunctuation' }],
    },
  ],
});
