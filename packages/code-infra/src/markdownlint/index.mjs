import straightQuotes from './straight-quotes.mjs';
import gitDiff from './git-diff.mjs';
import tableAlignment from './table-alignment.mjs';
import terminalLanguage from './terminal-language.mjs';
import duplicateH1 from './duplicate-h1.mjs';

/**
 * Create a base configuration for markdownlint.
 * @param {Object} options
 * @param {(typeof straightQuotes)[]} [options.rules] - An array of custom rules to include.
 * @param {string[]} [options.ignores] - An array of glob patterns to ignore.
 * @returns
 */
export function createBaseConfig(options = {}) {
  const { rules = [], ignores = [] } = options;
  // https://github.com/DavidAnson/markdownlint#rules--aliases
  return {
    config: {
      default: true,
      MD004: false, // MD004/ul-style. Buggy
      MD009: {
        // MD009/no-trailing-spaces
        br_spaces: 0,
        strict: true,
        list_item_empty_lines: false,
      },
      MD013: false, // MD013/line-length. Already handled by Prettier.
      MD014: false, // MD014/commands-show-output. It's OK.
      MD024: { siblings_only: true }, // MD024/no-duplicate-heading/no-duplicate-header
      MD025: {
        // Heading level
        level: 1,
        // RegExp for matching title in front matter
        front_matter_title: '',
      },
      MD033: false, // MD033/no-inline-html. We use it from time to time, it's fine.
      MD034: false, // MD034/no-bare-urls. Not a concern for us, our Markdown interpreter supports it.
      MD028: false, // MD028/no-blanks-blockquote prevent double blockquote
      MD029: false, // MD029/ol-prefix. Buggy
      MD031: false, // MD031/blanks-around-fences Some code blocks inside li
      MD036: false, // MD036/no-emphasis-as-heading/no-emphasis-as-header. It's OK.
      MD051: false, // MD051/link-fragments. Many false positives in the changelog.
      MD052: false, // MD052/reference-links-images. Many false positives in the changelog.
      MD059: false, // MD059/descriptive-link-text. Does not allow links on text like "link", whereas we redirect to "Link" component.
      straightQuotes: true,
      gitDiff: true,
      tableAlignment: true,
      terminalLanguage: true,
      duplicateH1: true,
    },
    customRules: [straightQuotes, gitDiff, tableAlignment, terminalLanguage, duplicateH1, ...rules],
    ignores: [
      'CHANGELOG.old.md',
      '**/node_modules/**',
      '**/build/**',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'docs/public/**',
      'docs/export/**',
      ...ignores,
    ],
  };
}
