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

          // Check if it's a binary expression with === or !==
          if (
            test.type === 'BinaryExpression' &&
            (test.operator === '===' || test.operator === '!==')
          ) {
            // Check if either side is process.env.NODE_ENV
            if (isProcessEnvNodeEnv(test.left) || isProcessEnvNodeEnv(test.right)) {
              return true;
            }
          }

          // Check for any construct involving process.env.NODE_ENV
          if (containsProcessEnvNodeEnv(test)) {
            return true;
          }
        }

        current = current.parent;
      }

      return false;
    }

    /**
     * Checks if a node contains process.env.NODE_ENV anywhere
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function containsProcessEnvNodeEnv(node) {
      if (isProcessEnvNodeEnv(node)) {
        return true;
      }

      // Recursively check child nodes (avoid circular references like 'parent')
      const keys = Object.keys(node);
      for (const key of keys) {
        // Skip parent to avoid circular references
        if (key === 'parent') {
          continue;
        }

        const value = node[key];
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === 'object' && containsProcessEnvNodeEnv(item)) {
                return true;
              }
            }
          } else if (containsProcessEnvNodeEnv(value)) {
            return true;
          }
        }
      }

      return false;
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
