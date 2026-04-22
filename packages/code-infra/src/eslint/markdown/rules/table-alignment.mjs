/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require an explicit alignment for every GFM table column. Text columns should be left aligned (`:---`), numeric columns right aligned (`---:`).',
    },
    messages: {
      missingAlignment:
        'Table column is missing an explicit alignment. Use `:---` for left, `---:` for right, or `:---:` for center.',
    },
    schema: [],
  },
  create(context) {
    return {
      /** @param {import('mdast').Table} node */
      table(node) {
        if (!Array.isArray(node.align) || node.align.length === 0) {
          return;
        }
        const headerRow = node.children?.[0];
        node.align.forEach(
          (
            /** @type {'left' | 'right' | 'center' | null} */ align,
            /** @type {number} */ index,
          ) => {
            if (align !== null) {
              return;
            }
            const cell = headerRow?.children?.[index];
            const loc = cell?.position ?? node.position;
            if (!loc) {
              return;
            }
            context.report({
              loc,
              messageId: 'missingAlignment',
            });
          },
        );
      },
    };
  },
};

export default rule;
