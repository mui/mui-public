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
export function isLiteralEq(node, value) {
  return node.type === 'Literal' && node.value === value;
}

/**
 * Checks if a node is a Literal with a value not equal to the specified one
 * @param {import('estree').Node} node
 * @param {string} value
 * @returns {boolean}
 */
export function isLiteralNeq(node, value) {
  return node.type === 'Literal' && node.value !== value;
}
