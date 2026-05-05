import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

const remarkLintMuiNoSpaceInLinks = lintRule(
  {
    origin: 'remark-lint:mui-no-space-in-links',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} tree */
  (tree, file) => {
    const source = String(file.value);
    visit(tree, 'link', (node) => {
      if (!node.position || node.children.length === 0) {
        return;
      }
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      if (!first.position || !last.position) {
        return;
      }
      const textStart = first.position.start.offset;
      const textEnd = last.position.end.offset;
      if (textStart === undefined || textEnd === undefined) {
        return;
      }
      const openBracket = source.lastIndexOf('[', textStart);
      const closeBracket = source.indexOf(']', textEnd);
      if (openBracket === -1 || closeBracket === -1) {
        return;
      }
      const innerText = source.slice(openBracket + 1, closeBracket);
      if (innerText.length === 0) {
        return;
      }
      if (innerText !== innerText.trim()) {
        file.message('Link text should not start or end with whitespace.', node);
      }
    });
  },
);

export default remarkLintMuiNoSpaceInLinks;
