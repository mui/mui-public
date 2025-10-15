import { isProcessEnvNodeEnv, isLiteral } from './nodeEnvUtils.mjs';

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
 *     'material-ui/consistent-production-guard': 'error'
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
     * Check if a guard is valid (process.env.NODE_ENV compared with literal 'production')
     * @param {import('estree').Node} envNode - The node that might be process.env.NODE_ENV
     * @param {import('estree').Node} valueNode - The node being compared with
     * @param {import('estree').BinaryExpression} binaryNode - The binary expression node
     */
    function checkGuard(envNode, valueNode, binaryNode) {
      if (isProcessEnvNodeEnv(envNode)) {
        // Must compare with literal 'production'
        if (!isLiteral(valueNode, 'production')) {
          context.report({
            node: binaryNode,
            messageId: 'invalidComparison',
            data: {
              comparedValue: valueNode.type === 'Literal' ? String(valueNode.value) : 'non-literal',
            },
          });
        }
      }
    }

    return {
      BinaryExpression(node) {
        // Check if this is a comparison with === or !==
        if (node.operator === '===' || node.operator === '!==') {
          checkGuard(node.left, node.right, node);
          checkGuard(node.right, node.left, node);
        }
      },
      // Catch any other usage of process.env.NODE_ENV (not in a valid binary expression)
      MemberExpression(node) {
        if (isProcessEnvNodeEnv(node)) {
          // Check if it's part of a valid binary expression
          const parent = node.parent;
          if (
            parent &&
            parent.type === 'BinaryExpression' &&
            (parent.operator === '===' || parent.operator === '!==')
          ) {
            // This is handled by BinaryExpression visitor
            return;
          }

          // Invalid usage
          context.report({
            node,
            messageId: 'invalidUsage',
          });
        }
      },
    };
  },
};

export default rule;
