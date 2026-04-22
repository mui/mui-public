import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './terminal-language.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('terminal-language', rule, {
  valid: [
    `\`\`\`bash
echo hi
\`\`\`
`,
    `\`\`\`js
const x = 1;
\`\`\`
`,
  ],
  invalid: [
    {
      code: `\`\`\`sh
echo hi
\`\`\`
`,
      errors: [{ messageId: 'useBash' }],
    },
  ],
});
