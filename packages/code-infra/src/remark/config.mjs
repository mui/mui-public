import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkLint from 'remark-lint';
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
    plugins: [
      [remarkFrontmatter, ['yaml', 'toml']],
      remarkGfm,
      remarkLint,
      ...entries.map(([, entry]) => entry),
    ],
  };
}
