import { lintRule } from 'unified-lint-rule';

const curlyQuotes = new Set(['‘', '’', '“', '”']);

const remarkLintMuiStraightQuotes = lintRule(
  {
    origin: 'remark-lint:mui-straight-quotes',
    url: 'https://github.com/mui/mui-public',
  },
  /** @param {import('mdast').Root} _tree */
  (_tree, file) => {
    const text = String(file.value);
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '\n') {
        line += 1;
        lineStart = index + 1;
      } else if (curlyQuotes.has(char)) {
        const column = index - lineStart + 1;
        file.message('Use straight quotes instead of curly quotes.', {
          start: { line, column },
          end: { line, column: column + 1 },
        });
      }
    }
  },
);

export default remarkLintMuiStraightQuotes;
