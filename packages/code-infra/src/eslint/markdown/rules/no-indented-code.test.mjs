import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './no-indented-code.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('no-indented-code', rule, {
  valid: [`\`\`\`js\nconst a = 1;\n\`\`\`\n`, `~~~\ntilde fence\n~~~\n`],
  invalid: [
    {
      code: `Paragraph before.\n\n    indented code block\n`,
      errors: [{ messageId: 'indentedCode' }],
    },
  ],
});
