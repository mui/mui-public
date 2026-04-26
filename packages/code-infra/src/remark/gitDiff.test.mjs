import { describe, it, expect } from 'vitest';
import { createLintTester } from './createLintTester.mjs';
import plugin from './gitDiff.mjs';

const lint = createLintTester(plugin);

describe('remark-lint-mui-git-diff', () => {
  it('accepts a well-formed unified diff', () => {
    const input = `# Title

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
`;
    expect(lint(input)).toEqual([]);
  });

  it('ignores non-diff code blocks', () => {
    const input = `\`\`\`js
const unrelated = 'line';
\`\`\`
`;
    expect(lint(input)).toEqual([]);
  });

  it('flags lines that do not match the unified diff prefixes', () => {
    const input = `\`\`\`diff
this line has no prefix
 valid line
bad line too
\`\`\`
`;
    const messages = lint(input);
    expect(messages).toHaveLength(2);
    expect(messages[0].line).toBe(2);
    expect(messages[1].line).toBe(4);
  });
});
