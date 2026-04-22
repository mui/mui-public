import blanksAroundTables from './rules/blanks-around-tables.mjs';
import gitDiff from './rules/git-diff.mjs';
import noClosedAtxHeading from './rules/no-closed-atx-heading.mjs';
import noIndentedCode from './rules/no-indented-code.mjs';
import noSpaceInLinks from './rules/no-space-in-links.mjs';
import noTrailingPunctuationInHeading from './rules/no-trailing-punctuation-in-heading.mjs';
import straightQuotes from './rules/straight-quotes.mjs';
import tableAlignment from './rules/table-alignment.mjs';
import terminalLanguage from './rules/terminal-language.mjs';

const markdownMuiPlugin = /** @type {import('eslint').ESLint.Plugin} */ ({
  meta: {
    name: '@mui/eslint-plugin-markdown',
    version: '0.1.0',
  },
  rules: {
    'blanks-around-tables': blanksAroundTables,
    'git-diff': gitDiff,
    'no-closed-atx-heading': noClosedAtxHeading,
    'no-indented-code': noIndentedCode,
    'no-space-in-links': noSpaceInLinks,
    'no-trailing-punctuation-in-heading': noTrailingPunctuationInHeading,
    'straight-quotes': straightQuotes,
    'table-alignment': tableAlignment,
    'terminal-language': terminalLanguage,
  },
});

export default markdownMuiPlugin;
