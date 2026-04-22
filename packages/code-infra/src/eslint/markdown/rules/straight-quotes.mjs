const nonStraightQuotes = /[‘’“”]/g;

/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Only allow straight quotes in Markdown.',
    },
    messages: {
      wrongQuotes: 'Use straight quotes instead of curly quotes.',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      'root:exit'() {
        const text = sourceCode.text;
        let match = nonStraightQuotes.exec(text);
        while (match !== null) {
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(match.index),
              end: sourceCode.getLocFromIndex(match.index + 1),
            },
            messageId: 'wrongQuotes',
          });
          match = nonStraightQuotes.exec(text);
        }
      },
    };
  },
};

export default rule;
