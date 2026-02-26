import { isProcessEnvNodeEnv, isLiteralEq, isLiteralNeq } from './nodeEnvUtils.mjs';

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
 *     'mui/require-dev-wrapper': ['error', {
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
     * Checks if a binary expression is comparing process.env.NODE_ENV appropriately
     * @param {import('estree').BinaryExpression} binaryExpression - The binary expression to check
     * @param {string} operator - The expected comparison operator (===, !==, etc.)
     * @param {string} value - The value to compare with
     * @returns {boolean}
     */
    function isNodeEnvComparison(binaryExpression, operator, value) {
      const { left, right } = binaryExpression;

      // Check for exact match with the specified value
      if (
        binaryExpression.operator === operator &&
        ((isProcessEnvNodeEnv(left) && isLiteralEq(right, value)) ||
          (isProcessEnvNodeEnv(right) && isLiteralEq(left, value)))
      ) {
        return true;
      }

      // For !== operator also allow === with any literal value that's NOT 'production'
      if (
        operator === '!==' &&
        binaryExpression.operator === '===' &&
        ((isProcessEnvNodeEnv(left) && isLiteralNeq(right, value)) ||
          (isProcessEnvNodeEnv(right) && isLiteralNeq(left, value)))
      ) {
        return true;
      }

      return false;
    }

    /**
     * Recursively checks if a test node contains a production guard.
     * The guard must appear on the left side of logical expressions.
     * @param {import('estree').Expression} testNode - The test expression to check
     * @param {string} operator - The expected comparison operator ('!==' or '===')
     * @returns {boolean}
     */
    function containsProductionGuard(testNode, operator) {
      if (
        testNode.type === 'BinaryExpression' &&
        isNodeEnvComparison(testNode, operator, 'production')
      ) {
        return true;
      }

      if (testNode.type === 'LogicalExpression') {
        // For consequent (operator '!=='): only && is safe (all conditions must hold)
        // For alternate (operator '==='): only || is safe (all conditions must fail)
        const safeLogicalOperator = operator === '!==' ? '&&' : '||';

        if (testNode.operator === safeLogicalOperator) {
          // Only check left operand — the guard must be on the left
          return containsProductionGuard(testNode.left, operator);
        }
      }

      return false;
    }

    /**
     * Checks if a node is wrapped in any production check conditional
     * @param {import('eslint').Rule.Node & import('eslint').Rule.NodeParentExtension} node
     * @returns {boolean}
     */
    function isWrappedInProductionCheck(node) {
      /** @type {import('eslint').Rule.Node | null} */
      let current = node.parent;
      /** @type {import('eslint').Rule.Node} */
      let currentChild = node;

      while (current) {
        // Check if we're inside an if statement
        if (current.type === 'IfStatement') {
          // Determine which branch we're in
          const isInConsequent = current.consequent === currentChild;
          const isInAlternate = current.alternate === currentChild;

          // Skip if not in a branch
          if (isInConsequent || isInAlternate) {
            const test = current.test;

            // If we're in the consequent, we need !==
            // If we're in the alternate (else), we need ===
            const operator = isInConsequent ? '!==' : '===';

            // Check for the specific pattern with the right operator
            if (containsProductionGuard(test, operator)) {
              return true;
            }
          }
        }

        currentChild = current;
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
