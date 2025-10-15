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
      nonStaticComparison:
        "Production guard must use a statically analyzable pattern. Use `process.env.NODE_ENV === 'production'` or `process.env.NODE_ENV !== 'production'` with a string literal.",
      invalidUsage:
        "process.env.NODE_ENV must be used in a binary comparison with === or !==. Use `process.env.NODE_ENV !== 'production'` or `process.env.NODE_ENV === 'production'`.",
    },
    schema: [],
  },
  create(context) {
    /**
     * Checks if a node is process.env.NODE_ENV
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function isProcessEnvNodeEnv(node) {
      return (
        node.type === 'MemberExpression' &&
        node.object.type === 'MemberExpression' &&
        node.object.object.type === 'Identifier' &&
        node.object.object.name === 'process' &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'env' &&
        node.property.type === 'Identifier' &&
        node.property.name === 'NODE_ENV'
      );
    }

    return {
      BinaryExpression(node) {
        // Check if this is a comparison with === or !==
        if (node.operator === '===' || node.operator === '!==') {
          // Check if left side is process.env.NODE_ENV
          if (isProcessEnvNodeEnv(node.left)) {
            // Right side must be a literal
            if (node.right.type !== 'Literal') {
              context.report({
                node,
                messageId: 'nonStaticComparison',
              });
              return;
            }

            // Right side must be the string 'production'
            if (node.right.value !== 'production') {
              context.report({
                node,
                messageId: 'invalidComparison',
                data: {
                  comparedValue: String(node.right.value),
                },
              });
            }
          }
          // Check if right side is process.env.NODE_ENV (reversed comparison)
          else if (isProcessEnvNodeEnv(node.right)) {
            // Left side must be a literal
            if (node.left.type !== 'Literal') {
              context.report({
                node,
                messageId: 'nonStaticComparison',
              });
              return;
            }

            // Left side must be the string 'production'
            if (node.left.value !== 'production') {
              context.report({
                node,
                messageId: 'invalidComparison',
                data: {
                  comparedValue: String(node.left.value),
                },
              });
            }
          }
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
