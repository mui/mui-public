import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkLint from 'remark-lint';
import { visit } from 'unist-util-visit';
import remarkLintCodeBlockStyle from 'remark-lint-code-block-style';
import remarkLintHeadingStyle from 'remark-lint-heading-style';
import remarkLintNoDuplicateHeadings from 'remark-lint-no-duplicate-headings';
import remarkLintNoHeadingPunctuation from 'remark-lint-no-heading-punctuation';
import remarkLintNoMissingBlankLines from 'remark-lint-no-missing-blank-lines';
import remarkLintNoMultipleToplevelHeadings from 'remark-lint-no-multiple-toplevel-headings';
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references';
import remarkLintTablePipes from 'remark-lint-table-pipes';
import muiGitDiff from './gitDiff.mjs';
import muiNoSpaceInLinks from './noSpaceInLinks.mjs';
import muiStraightQuotes from './straightQuotes.mjs';
import muiTerminalLanguage from './terminalLanguage.mjs';

const GITHUB_ALERT_LABELS = ['!NOTE', '!TIP', '!WARNING', '!IMPORTANT', '!CAUTION'];

// remark-stringify wraps bare URLs (e.g. `http://example.com`) in angle brackets
// on round-trip because the parsed `link` node is indistinguishable from an
// explicit `<url>` autolink. GFM re-parses bare URLs anyway, so lower them to
// raw `html` nodes here so they emit verbatim.
function remarkUnwrapBareUrlAutolinks() {
  /** @param {import('mdast').Root} tree */
  return (tree) => {
    visit(tree, 'link', (node, index, parent) => {
      if (
        parent &&
        index != null &&
        node.url &&
        !node.title &&
        node.children?.length === 1 &&
        node.children[0].type === 'text' &&
        node.children[0].value === node.url &&
        /^(https?|ftp):\/\//i.test(node.url) &&
        !/[\0- <>]/.test(node.url)
      ) {
        parent.children[index] = { type: 'html', value: node.url };
      }
    });
  };
}

const RULES = {
  'no-duplicate-headings': [remarkLintNoDuplicateHeadings, ['error']],
  'no-multiple-toplevel-headings': [remarkLintNoMultipleToplevelHeadings, ['error']],
  'no-undefined-references': [
    remarkLintNoUndefinedReferences,
    ['error', { allow: GITHUB_ALERT_LABELS, allowShortcutLink: true }],
  ],
  'heading-style': [remarkLintHeadingStyle, ['error', 'atx']],
  'no-heading-punctuation': [remarkLintNoHeadingPunctuation, ['error']],
  'code-block-style': [remarkLintCodeBlockStyle, ['error', 'fenced']],
  'table-pipes': [remarkLintTablePipes, ['error']],
  'no-missing-blank-lines': [remarkLintNoMissingBlankLines, ['error', { exceptTightLists: true }]],
  'mui-git-diff': [muiGitDiff, ['error']],
  'mui-no-space-in-links': [muiNoSpaceInLinks, ['error']],
  'mui-straight-quotes': [muiStraightQuotes, ['error']],
  'mui-terminal-language': [muiTerminalLanguage, ['error']],
};

/**
 * Returns a remark preset wiring the MUI-authored remark-lint plugins together
 * with a curated set of community plugins. Drop this into `.remarkrc.mjs`:
 *
 * ```js
 * import { createRemarkConfig } from '@mui/internal-code-infra/remark';
 * export default createRemarkConfig();
 * ```
 *
 * Pass `disable` to turn off specific rules by name (the key used in `RULES`),
 * for example when composing a nested config that relaxes a handful of checks.
 *
 * @param {Object} [options]
 * @param {string[]} [options.disable]
 */
export function createRemarkConfig({ disable = [] } = {}) {
  const unknown = disable.filter((name) => !(name in RULES));
  if (unknown.length > 0) {
    throw new Error(`Unknown remark-lint rule name(s): ${unknown.join(', ')}`);
  }
  const entries = Object.entries(RULES).filter(([name]) => !disable.includes(name));
  return {
    settings: {
      bullet: '-',
      emphasis: '_',
      fence: '`',
      listItemIndent: 'one',
      rule: '-',
    },
    plugins: [
      [remarkFrontmatter, ['yaml', 'toml']],
      remarkGfm,
      remarkLint,
      ...entries.map(([, entry]) => entry),
      remarkUnwrapBareUrlAutolinks,
    ],
  };
}
