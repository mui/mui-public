import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

const remarkLintMuiTerminalLanguage = lintRule(
  {
    origin: 'remark-lint:mui-terminal-language',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} tree */
  (tree, file) => {
    visit(tree, 'code', (node) => {
      if (node.lang === 'sh' && node.position) {
        file.message('Use `bash` instead of `sh` as the code block language.', node);
      }
    });
  },
);

export default remarkLintMuiTerminalLanguage;
