import { isNodeEnvComparison } from './nodeEnvUtils.mjs';

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
        "Function `{{ functionName }}` must be wrapped with a production check (e.g., `if (process.env.NODE_ENV !== 'production')`) to prevent it from ending up in production bundles.",
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
     * Checks if a node is wrapped in any production check conditional
     * @param {import('estree').Node & import('eslint').Rule.NodeParentExtension} node
     * @returns {boolean}
     */
    function isWrappedInProductionCheck(node) {
      let current = node.parent;

      while (current) {
        // Check if we're inside an if statement
        if (current.type === 'IfStatement') {
          // Determine which branch we're in
          let isInConsequent = false;
          let temp = node;
          while (temp && temp !== current) {
            if (temp === current.consequent) {
              isInConsequent = true;
              break;
            }
            if (temp === current.alternate) {
              isInConsequent = false;
              break;
            }
            temp = temp.parent;
          }

          // Skip if not in a branch
          if (temp === current) {
            current = current.parent;
            continue;
          }

          const test = current.test;

          // If we're in the consequent, we need !==
          // If we're in the alternate (else), we need ===
          const operator = isInConsequent ? '!==' : '===';

          // Check for the specific pattern with the right operator
          if (
            test.type === 'BinaryExpression' &&
            isNodeEnvComparison(test, operator, 'production')
          ) {
            return true;
          }
        }

        current = current.parent;
      }

      return false;
    }

    return {
      CallExpression(node) {
        // Check if the callee is one of the restricted function names
        if (node.callee.type === 'Identifier' && functionNames.includes(node.callee.name)) {
          if (!isWrappedInProductionCheck(node)) {
            context.report({
              node,
              messageId: 'missingDevWrapper',
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
