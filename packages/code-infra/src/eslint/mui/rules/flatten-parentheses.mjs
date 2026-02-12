import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mui/mui-public/blob/master/packages/code-infra/src/eslint/mui/rules/${name}.mjs`,
);

const RULE_NAME = 'flatten-parentheses';

/**
 * Checks if a type node has surrounding parentheses by examining tokens.
 * @param {any} node
 * @param {any} sourceCode
 * @returns {boolean}
 */
function hasParentheses(node, sourceCode) {
  const tokenBefore = sourceCode.getTokenBefore(node);
  const tokenAfter = sourceCode.getTokenAfter(node);

  return (
    tokenBefore?.value === '(' &&
    tokenBefore?.type === 'Punctuator' &&
    tokenAfter?.value === ')' &&
    tokenAfter?.type === 'Punctuator'
  );
}

/**
 * Checks if a union/intersection type within parentheses can be safely flattened.
 * @param {import('@typescript-eslint/types').TSESTree.TSUnionType | import('@typescript-eslint/types').TSESTree.TSIntersectionType} node
 * @param {import('@typescript-eslint/types').TSESTree.Node | undefined} parent
 * @param {any} sourceCode
 * @returns {boolean}
 */
function canFlatten(node, parent, sourceCode) {
  // Check if this node has parentheses in the source
  if (!hasParentheses(node, sourceCode)) {
    return false;
  }

  // If parent is not a union or intersection, parentheses might be needed
  if (
    !parent ||
    (parent.type !== AST_NODE_TYPES.TSUnionType &&
      parent.type !== AST_NODE_TYPES.TSIntersectionType)
  ) {
    return false;
  }

  // Only safe to flatten if both are the same operator type
  // (union with union, or intersection with intersection)
  return parent.type === node.type;
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
  name: RULE_NAME,
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * Check a union or intersection type node
     * @param {import('@typescript-eslint/types').TSESTree.TSUnionType | import('@typescript-eslint/types').TSESTree.TSIntersectionType} node
     */
    function checkNode(node) {
      const operatorType = node.type === AST_NODE_TYPES.TSUnionType ? 'union' : 'intersection';

      // Check each type in the union/intersection
      for (const typeNode of node.types) {
        // Check if this is a union/intersection that can be flattened
        if (
          (typeNode.type === AST_NODE_TYPES.TSUnionType ||
            typeNode.type === AST_NODE_TYPES.TSIntersectionType) &&
          canFlatten(typeNode, node, sourceCode)
        ) {
          context.report({
            node: typeNode,
            messageId: 'flattenParentheses',
            data: {
              operatorType,
            },
            fix(fixer) {
              // Remove only the opening and closing parentheses tokens to preserve comments and formatting
              const tokenBefore = sourceCode.getTokenBefore(typeNode);
              const tokenAfter = sourceCode.getTokenAfter(typeNode);
              return [fixer.removeRange(tokenBefore.range), fixer.removeRange(tokenAfter.range)];
            },
          });
        }
      }
    }

    return {
      TSUnionType: checkNode,
      TSIntersectionType: checkNode,
    };
  },
});
