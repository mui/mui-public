const singleCharPrefixes = new Set([' ', '-', '+']);
const linePrefixes = ['@@ ', 'diff --git ', 'index '];

/**
 * @type {import('@eslint/markdown').MarkdownRuleDefinition}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate that lines in a `diff` code fence follow the unified diff format.',
    },
    messages: {
      invalidDiffLine:
        'Line in a `diff` code block must start with " ", "+", "-", "@@ ", "diff --git ", or "index ".',
    },
    schema: [],
  },
  create(context) {
    return {
      /** @param {import('mdast').Code} node */
      code(node) {
        if (node.lang !== 'diff') {
          return;
        }
        if (!node.position) {
          return;
        }
        const contentStartLine = node.position.start.line + 1;
        const lines = node.value.split('\n');
        lines.forEach((/** @type {string} */ line, /** @type {number} */ index) => {
          if (line === '') {
            return;
          }
          if (singleCharPrefixes.has(line[0])) {
            return;
          }
          if (linePrefixes.some((prefix) => line.startsWith(prefix))) {
            return;
          }
          const lineNumber = contentStartLine + index;
          context.report({
            loc: {
              start: { line: lineNumber, column: 1 },
              end: { line: lineNumber, column: line.length + 1 },
            },
            messageId: 'invalidDiffLine',
          });
        });
      },
    };
  },
};

export default rule;
