/**
 * ESLint rule that enforces certain function calls to be wrapped with
 * a production check to prevent them from ending up in production bundles.
 *
 * @example
 * // Valid - function wrapped with production check
 * if (process.env.NODE_ENV !== 'production') {
 *   checkSlot(key, overrides[k]);
 * }
 *
 * @example
 * // Invalid - function not wrapped
 * checkSlot(key, overrides[k]); // Will trigger error
 *
 * @example
 * // Invalid - wrong condition (=== instead of !==)
 * if (process.env.NODE_ENV === 'production') {
 *   checkSlot(key, overrides[k]); // Will trigger error
 * }
 *
 * @example
 * // Usage in ESLint config
 * {
 *   rules: {
 *     'material-ui/require-dev-wrapper': ['error', {
 *       functionNames: ['warnOnce', 'warn', 'checkSlot']
 *     }]
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
        'Enforce that certain function calls are wrapped with a production check to prevent them from ending up in production bundles',
    },
    messages: {
      missingDevWrapper:
        "Function `{{ functionName }}` must be wrapped with `if (process.env.NODE_ENV !== 'production')` to prevent it from ending up in production bundles.",
      wrongCondition:
        "Function `{{ functionName }}` must be wrapped with `if (process.env.NODE_ENV !== 'production')` (not `===`).",
    },
    schema: [
      {
        type: 'object',
        properties: {
          functionNames: {
            type: 'array',
            items: {
              type: 'string',
            },
            default: ['warnOnce', 'warn', 'checkSlot'],
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const functionNames = options.functionNames || ['warnOnce', 'warn', 'checkSlot'];

    /**
     * Checks if a node is wrapped in a production check conditional
     * @param {import('estree').Node & import('eslint').Rule.NodeParentExtension} node
     * @returns {{ wrapped: boolean; wrongCondition: boolean }}
     */
    function isWrappedInProductionCheck(node) {
      let current = node.parent;

      while (current) {
        // Check if we're inside an if statement
        if (current.type === 'IfStatement') {
          const test = current.test;

          // Make sure we're in the consequent (then) block, not the alternate (else) block
          let isInConsequent = false;
          let temp = node;
          while (temp && temp !== current) {
            if (temp === current.consequent) {
              isInConsequent = true;
              break;
            }
            temp = temp.parent;
          }

          if (!isInConsequent) {
            // Continue looking up the tree if we're in the alternate branch
            current = current.parent;
            continue;
          }

          // Check for: process.env.NODE_ENV !== 'production'
          if (
            test.type === 'BinaryExpression' &&
            test.operator === '!==' &&
            isProcessEnvNodeEnv(test.left) &&
            test.right.type === 'Literal' &&
            test.right.value === 'production'
          ) {
            return { wrapped: true, wrongCondition: false };
          }

          // Check for wrong condition: process.env.NODE_ENV === 'production'
          if (
            test.type === 'BinaryExpression' &&
            test.operator === '===' &&
            isProcessEnvNodeEnv(test.left) &&
            test.right.type === 'Literal' &&
            test.right.value === 'production'
          ) {
            return { wrapped: true, wrongCondition: true };
          }
        }

        current = current.parent;
      }

      return { wrapped: false, wrongCondition: false };
    }

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
      CallExpression(node) {
        // Check if the callee is one of the restricted function names
        if (node.callee.type === 'Identifier' && functionNames.includes(node.callee.name)) {
          const { wrapped, wrongCondition } = isWrappedInProductionCheck(node);

          if (!wrapped) {
            context.report({
              node,
              messageId: 'missingDevWrapper',
              data: {
                functionName: node.callee.name,
              },
            });
          } else if (wrongCondition) {
            context.report({
              node,
              messageId: 'wrongCondition',
              data: {
                functionName: node.callee.name,
              },
            });
          }
        }
      },
    };
  },
};

export default rule;
