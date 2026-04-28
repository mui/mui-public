import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

const remarkLintMuiTableAlignment = lintRule(
  {
    origin: 'remark-lint:mui-table-alignment',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} tree */
  (tree, file) => {
    visit(tree, 'table', (node) => {
      const align = node.align ?? [];
      if (align.some((value) => value == null)) {
        file.message(
          'Table columns should declare an explicit alignment (`:---`, `---:`, or `:---:`).',
          node,
        );
      }
    });
  },
);

export default remarkLintMuiTableAlignment;
