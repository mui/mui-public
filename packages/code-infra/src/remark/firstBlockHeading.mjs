import { lintRule } from 'unified-lint-rule';

const FRONTMATTER_TYPES = new Set(['yaml', 'toml']);
const INVISIBLE_TAGS = new Set(['style', 'script']);
const DEFAULT_FRONT_MATTER_TITLE = /^\s*"?title"?\s*[:=]/m;

/** @param {import('mdast').RootContent} node */
const isSkippable = (node) => {
  const type = /** @type {string} */ (node.type);
  if (FRONTMATTER_TYPES.has(type)) {
    return true;
  }
  if (type === 'html') {
    const value = /** @type {{ value: string }} */ (/** @type {unknown} */ (node)).value.trim();
    if (value.startsWith('<!--')) {
      return true;
    }
    const match = value.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/);
    if (match && INVISIBLE_TAGS.has(match[1].toLowerCase())) {
      return true;
    }
  }
  if (type === 'mdxJsxFlowElement') {
    const name = /** @type {{ name: string | null }} */ (/** @type {unknown} */ (node)).name;
    if (name && INVISIBLE_TAGS.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
};

/**
 * @param {import('mdast').Root} tree
 * @param {RegExp | false} pattern
 */
const hasFrontMatterTitle = (tree, pattern) => {
  if (!pattern) {
    return false;
  }
  const frontMatter = tree.children.find((child) => FRONTMATTER_TYPES.has(child.type));
  if (!frontMatter) {
    return false;
  }
  return pattern.test(
    /** @type {{ value: string }} */ (/** @type {unknown} */ (frontMatter)).value,
  );
};

const remarkLintMuiFirstBlockHeading = lintRule(
  {
    origin: 'remark-lint:mui-first-block-heading',
    url: 'https://github.com/mui/mui-public',
  },
  /** @type {import('unified-lint-rule').Rule<import('mdast').Root, { frontMatterTitle?: RegExp | false } | undefined>} */
  (tree, file, options) => {
    const frontMatterTitle =
      options?.frontMatterTitle === undefined
        ? DEFAULT_FRONT_MATTER_TITLE
        : options.frontMatterTitle;
    if (hasFrontMatterTitle(tree, frontMatterTitle)) {
      return;
    }
    const firstBlock = tree.children.find((child) => !isSkippable(child));
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
