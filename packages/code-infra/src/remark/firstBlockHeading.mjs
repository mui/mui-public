import { lintRule } from 'unified-lint-rule';

const FRONTMATTER_TYPES = new Set(['yaml', 'toml']);

const remarkLintMuiFirstBlockHeading = lintRule(
  {
    origin: 'remark-lint:mui-first-block-heading',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} tree */
  (tree, file) => {
    const firstBlock = tree.children.find((child) => !FRONTMATTER_TYPES.has(child.type));
    if (!firstBlock) {
      file.message('Documents must begin with a top-level heading.');
      return;
    }
    if (firstBlock.type !== 'heading' || firstBlock.depth !== 1) {
      file.message('Documents must begin with a top-level heading.', firstBlock);
    }
  },
);

export default remarkLintMuiFirstBlockHeading;
