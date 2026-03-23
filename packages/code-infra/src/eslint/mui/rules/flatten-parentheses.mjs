import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/mui/rules/${name}.mjs`,
);

/**
 * Returns the source range including surrounding parentheses, or null if the node is not parenthesized.
 * @param {import('@typescript-eslint/types').TSESTree.Node} node
 * @param {import('@typescript-eslint/utils').TSESLint.SourceCode} sourceCode
 * @returns {[number, number] | null}
 */
function getParenthesizedRange(node, sourceCode) {
  const tokenBefore = sourceCode.getTokenBefore(node);
  const tokenAfter = sourceCode.getTokenAfter(node);

  if (
    tokenBefore?.value === '(' &&
    tokenBefore?.type === 'Punctuator' &&
    tokenAfter?.value === ')' &&
    tokenAfter?.type === 'Punctuator'
  ) {
    return [tokenBefore.range[0], tokenAfter.range[1]];
  }

  return null;
}

export default createRule({
  meta: {
    docs: {
      description:
        'Flatten unnecessary parentheses in TypeScript unions and intersections when safe to do so. NOTE: This rule will become obsolete once Prettier handles this formatting automatically (see https://github.com/prettier/prettier/issues/13500).',
    },
    messages: {
      flattenParentheses:
        'Unnecessary parentheses in {{ operatorType }}. The inner types can be flattened.',
    },
    type: 'suggestion',
    fixable: 'code',
    schema: [],
  },
  name: 'flatten-parentheses',
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * @param {import('@typescript-eslint/types').TSESTree.TSUnionType | import('@typescript-eslint/types').TSESTree.TSIntersectionType} node
     */
    function checkNode(node) {
      const operatorType = node.type === AST_NODE_TYPES.TSUnionType ? 'union' : 'intersection';

      for (const typeNode of node.types) {
        // Only flatten when the child operator matches the parent (union-in-union or intersection-in-intersection)
        if (typeNode.type !== node.type) {
          continue;
        }

        const range = getParenthesizedRange(typeNode, sourceCode);
        if (!range) {
          continue;
        }

        context.report({
          node: typeNode,
          messageId: 'flattenParentheses',
          data: { operatorType },
          fix(fixer) {
            // Use text between parens (exclusive) to preserve any interleaved comments
            let innerText = sourceCode.text.slice(range[0] + 1, range[1] - 1).trimStart();
            // Strip the leading operator if present (e.g., leading | in `(| A | B)`)
            const operator = node.type === AST_NODE_TYPES.TSUnionType ? '|' : '&';
            if (innerText.startsWith(operator)) {
              innerText = innerText.slice(1).trimStart();
            }
            return fixer.replaceTextRange(range, innerText);
          },
        });
      }
    }

    return {
      TSUnionType: checkNode,
      TSIntersectionType: checkNode,
    };
  },
});
