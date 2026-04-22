/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a blank line after a GFM table (equivalent to markdownlint MD058). GFM already requires a blank line before the table for it to parse, so only the trailing case needs explicit enforcement.',
    },
    messages: {
      missingBlankAfter: 'Table should be followed by a blank line.',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    const lines = sourceCode.text.split('\n');
    return {
      /** @param {import('mdast').Table} node */
      table(node) {
        if (!node.position) {
          return;
        }
        const endLine = node.position.end.line;
        if (endLine < lines.length) {
          const lineAfter = lines[endLine];
          if (lineAfter !== undefined && lineAfter.trim() !== '') {
            context.report({
              loc: {
                start: { line: endLine, column: 1 },
                end: { line: endLine, column: 1 },
              },
              messageId: 'missingBlankAfter',
            });
          }
        }
      },
    };
  },
};

export default rule;
