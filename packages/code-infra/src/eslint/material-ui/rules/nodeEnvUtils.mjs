/**
 * Shared utilities for ESLint rules dealing with process.env.NODE_ENV
 */

/**
 * Checks if a node is process.env.NODE_ENV
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
export function isProcessEnvNodeEnv(node) {
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

/**
 * Checks if a node is a Literal with a specific value
 * @param {import('estree').Node} node
 * @param {string} value
 * @returns {boolean}
 */
export function isLiteral(node, value) {
  return node.type === 'Literal' && node.value === value;
}

/**
 * Checks if a binary expression is comparing process.env.NODE_ENV with a value
 * @param {import('estree').Node} left - Left side of comparison
 * @param {import('estree').Node} right - Right side of comparison
 * @param {string} operator - The comparison operator (===, !==, etc.)
 * @param {string} value - The value to compare with
 * @returns {boolean}
 */
export function isNodeEnvComparison(left, right, operator, value) {
  return (
    (operator === '===' || operator === '!==') &&
    ((isProcessEnvNodeEnv(left) && isLiteral(right, value)) ||
      (isProcessEnvNodeEnv(right) && isLiteral(left, value)))
  );
}
