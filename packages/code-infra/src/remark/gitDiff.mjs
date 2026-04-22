import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

const singleCharPrefixes = new Set([' ', '-', '+']);
const linePrefixes = ['@@ ', 'diff --git ', 'index '];

const remarkLintMuiGitDiff = lintRule(
  {
    origin: 'remark-lint:mui-git-diff',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} tree */
  (tree, file) => {
    visit(tree, 'code', (node) => {
      if (node.lang !== 'diff' || !node.position) {
        return;
      }
      const contentStartLine = node.position.start.line + 1;
      const lines = node.value.split('\n');
      lines.forEach((line, index) => {
        if (line === '') {
          return;
        }
        if (singleCharPrefixes.has(line[0])) {
          return;
        }
        if (linePrefixes.some((prefix) => line.startsWith(prefix))) {
          return;
        }
        const lineNumber = contentStartLine + index;
        file.message(
          'Line in a `diff` code block must start with " ", "+", "-", "@@ ", "diff --git ", or "index ".',
          {
            start: { line: lineNumber, column: 1 },
            end: { line: lineNumber, column: line.length + 1 },
          },
        );
      });
    });
  },
);

export default remarkLintMuiGitDiff;
