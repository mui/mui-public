import { isProcessEnvNodeEnv, isLiteralEq } from './nodeEnvUtils.mjs';

/**
 * ESLint rule that enforces consistent patterns for production guard checks.
 *
 * @example
 * // Valid - comparing with 'production'
 * if (process.env.NODE_ENV !== 'production') {}
 *
 * @example
 * // Valid - comparing with 'production'
 * if (process.env.NODE_ENV === 'production') {}
 *
 * @example
 * // Invalid - comparing with 'development'
 * if (process.env.NODE_ENV === 'development') {}
 *
 * @example
 * // Invalid - comparing with 'test'
 * if (process.env.NODE_ENV !== 'test') {}
 *
 * @example
 * // Invalid - non-static construct
 * const env = 'production';
 * if (process.env.NODE_ENV !== env) {}
 *
 * @example
 * // Usage in ESLint config
 * {
 *   rules: {
 *     'mui/consistent-production-guard': 'error'
 *   }
 * }
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce consistent patterns for production guard checks using process.env.NODE_ENV',
    },
    messages: {
      invalidComparison:
        "Only compare process.env.NODE_ENV with 'production'. Use `process.env.NODE_ENV !== 'production'` or `process.env.NODE_ENV === 'production'` instead of comparing with '{{ comparedValue }}'.",
      invalidUsage:
        "process.env.NODE_ENV must be used in a binary comparison with === or !== and a literal 'production'. Use `process.env.NODE_ENV !== 'production'` or `process.env.NODE_ENV === 'production'`.",
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import("estree").BinaryExpression} binaryNode
     * @param {import("estree").Expression | import("estree").PrivateIdentifier} valueNode
     */
    function report(binaryNode, valueNode) {
      context.report({
        node: binaryNode,
        messageId: 'invalidComparison',
        data: {
          comparedValue: valueNode.type === 'Literal' ? String(valueNode.value) : 'non-literal',
        },
      });
    }

    return {
      MemberExpression(node) {
        if (isProcessEnvNodeEnv(node)) {
          // Check if it's part of a valid binary expression
          const parent = node.parent;
          if (
            parent &&
            parent.type === 'BinaryExpression' &&
            (parent.operator === '===' || parent.operator === '!==')
          ) {
            if (parent.left === node && !isLiteralEq(parent.right, 'production')) {
              report(parent, parent.right);
            } else if (parent.right === node && !isLiteralEq(parent.left, 'production')) {
              report(parent, parent.left);
            }
            // Valid usage, do nothing
          } else {
            context.report({
              node,
              messageId: 'invalidUsage',
            });
          }
        }
      },
    };
  },
};

export default rule;
