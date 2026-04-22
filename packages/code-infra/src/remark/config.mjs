import remarkGfm from 'remark-gfm';
import remarkLintCodeBlockStyle from 'remark-lint-code-block-style';
import remarkLintHeadingStyle from 'remark-lint-heading-style';
import remarkLintNoDuplicateHeadings from 'remark-lint-no-duplicate-headings';
import remarkLintNoHeadingPunctuation from 'remark-lint-no-heading-punctuation';
import remarkLintNoMissingBlankLines from 'remark-lint-no-missing-blank-lines';
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references';
import remarkLintTablePipes from 'remark-lint-table-pipes';
import muiGitDiff from './gitDiff.mjs';
import muiNoSpaceInLinks from './noSpaceInLinks.mjs';
import muiStraightQuotes from './straightQuotes.mjs';
import muiTerminalLanguage from './terminalLanguage.mjs';

const GITHUB_ALERT_LABELS = ['!NOTE', '!TIP', '!WARNING', '!IMPORTANT', '!CAUTION'];

/**
 * Returns a remark preset wiring the MUI-authored remark-lint plugins together
 * with a curated set of community plugins. Drop this into `.remarkrc.mjs`:
 *
 * ```js
 * import { createRemarkConfig } from '@mui/internal-code-infra/remark';
 * export default createRemarkConfig();
 * ```
 */
export function createRemarkConfig() {
  return {
    plugins: [
      remarkGfm,
      [remarkLintNoDuplicateHeadings, ['error']],
      [
        remarkLintNoUndefinedReferences,
        ['error', { allow: GITHUB_ALERT_LABELS, allowShortcutLink: true }],
      ],
      [remarkLintHeadingStyle, ['error', 'atx']],
      [remarkLintNoHeadingPunctuation, ['error']],
      [remarkLintCodeBlockStyle, ['error', 'fenced']],
      [remarkLintTablePipes, ['error']],
      [remarkLintNoMissingBlankLines, ['error', { exceptTightLists: true }]],
      [muiGitDiff, ['error']],
      [muiNoSpaceInLinks, ['error']],
      [muiStraightQuotes, ['error']],
      [muiTerminalLanguage, ['error']],
    ],
  };
}
