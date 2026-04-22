const defaultPunctuation = '.,;:!。，；：！';

/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition<{ RuleOptions: [{ punctuation?: string }] }>}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow trailing punctuation in headings (equivalent to markdownlint MD026).',
    },
    messages: {
      trailingPunctuation: 'Heading ends with disallowed punctuation character "{{char}}".',
    },
    schema: [
      {
        type: 'object',
        properties: {
          punctuation: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ punctuation: defaultPunctuation }],
  },
  create(context) {
    const { punctuation = defaultPunctuation } = context.options[0] ?? {};
    const forbidden = new Set(punctuation);
    return {
      /** @param {import('mdast').Heading} node */
      heading(node) {
        if (!node.position) {
          return;
        }
        const text = context.sourceCode.getText(node).trimEnd();
        // Strip trailing closing ATX hashes if present, e.g. "### foo ###".
        const withoutClosingHashes = text.replace(/\s+#+\s*$/, '');
        const lastChar = withoutClosingHashes[withoutClosingHashes.length - 1];
        if (lastChar && forbidden.has(lastChar)) {
          context.report({
            loc: node.position,
            messageId: 'trailingPunctuation',
            data: { char: lastChar },
          });
        }
      },
    };
  },
};

export default rule;
