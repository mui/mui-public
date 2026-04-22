/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require fenced code blocks; disallow indented code blocks (equivalent to markdownlint MD046 with `style: "fenced"`).',
    },
    messages: {
      indentedCode: 'Use a fenced code block (```) instead of an indented one.',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      /** @param {import('mdast').Code} node */
      code(node) {
        if (!node.position || node.position.start.offset === undefined) {
          return;
        }
        const firstChar = sourceCode.text[node.position.start.offset];
        if (firstChar !== '`' && firstChar !== '~') {
          context.report({
            loc: node.position,
            messageId: 'indentedCode',
          });
        }
      },
    };
  },
};

export default rule;
