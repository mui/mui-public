/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow spaces surrounding link text (equivalent to markdownlint MD039).',
    },
    messages: {
      spaceInLink: 'Link text should not start or end with whitespace.',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      /** @param {import('mdast').Link} node */
      link(node) {
        if (!node.position || node.children.length === 0) {
          return;
        }
        const first = node.children[0];
        const last = node.children[node.children.length - 1];
        if (!first.position || !last.position) {
          return;
        }
        const source = sourceCode.text;
        // Link text lives between the opening `[` (node start + 1) and the closing `]`
        // before the URL portion. Use the first/last child's offsets as a proxy.
        const textStart = first.position.start.offset;
        const textEnd = last.position.end.offset;
        if (textStart === undefined || textEnd === undefined) {
          return;
        }
        const openBracket = source.lastIndexOf('[', textStart);
        const closeBracket = source.indexOf(']', textEnd);
        if (openBracket === -1 || closeBracket === -1) {
          return;
        }
        const innerText = source.slice(openBracket + 1, closeBracket);
        if (innerText.length === 0) {
          return;
        }
        if (innerText !== innerText.trim()) {
          context.report({
            loc: node.position,
            messageId: 'spaceInLink',
          });
        }
      },
    };
  },
};

export default rule;
