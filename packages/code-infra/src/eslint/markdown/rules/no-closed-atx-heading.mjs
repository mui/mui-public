/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow ATX headings with closing hash characters, e.g. `### foo ###` (covers markdownlint MD020/MD021).',
    },
    messages: {
      closedAtx: 'ATX headings should not have closing hash characters.',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      /** @param {import('mdast').Heading} node */
      heading(node) {
        if (!node.position) {
          return;
        }
        // Only inspect single-line ATX headings (setext headings span 2 lines).
        if (node.position.start.line !== node.position.end.line) {
          return;
        }
        const line = sourceCode.text.slice(node.position.start.offset, node.position.end.offset);
        // ATX headings start with one or more `#`. Setext underline heading
        // sources don't start with `#`.
        if (!line.startsWith('#')) {
          return;
        }
        if (/\s#+\s*$/.test(line)) {
          context.report({
            loc: node.position,
            messageId: 'closedAtx',
          });
        }
      },
    };
  },
};

export default rule;
