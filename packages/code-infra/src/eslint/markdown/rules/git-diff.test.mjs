import { createMarkdownRuleTester } from './createMarkdownRuleTester.mjs';
import rule from './git-diff.mjs';

const ruleTester = createMarkdownRuleTester();

ruleTester.run('git-diff', rule, {
  valid: [
    `# Title

\`\`\`diff
diff --git a/foo.txt b/foo.txt
index 0000..1111 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,2 +1,2 @@
 unchanged line
-removed line
+added line
\`\`\`
`,
    // Non-diff code blocks are ignored.
    `\`\`\`js
const unrelated = 'line';
\`\`\`
`,
  ],
  invalid: [
    {
      code: `\`\`\`diff
this line has no prefix
 valid line
bad line too
\`\`\`
`,
      errors: [
        { messageId: 'invalidDiffLine', line: 2 },
        { messageId: 'invalidDiffLine', line: 4 },
      ],
    },
  ],
});
