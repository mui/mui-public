/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Use `bash` instead of `sh` as the language for terminal code blocks.',
    },
    messages: {
      useBash: 'Use `bash` instead of `sh` as the code block language.',
    },
    schema: [],
  },
  create(context) {
    return {
      /** @param {import('mdast').Code} node */
      code(node) {
        if (node.lang !== 'sh' || !node.position) {
          return;
        }
        context.report({
          loc: node.position,
          messageId: 'useBash',
        });
      },
    };
  },
};

export default rule;
