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
 * @param {import('estree').BinaryExpression} binaryExpression - The binary expression to check
 * @param {string} operator - The expected comparison operator (===, !==, etc.)
 * @param {string} value - The value to compare with
 * @returns {boolean}
 */
export function isNodeEnvComparison(binaryExpression, operator, value) {
  if (binaryExpression.type !== 'BinaryExpression') {
    return false;
  }

  const { left, right } = binaryExpression;

  // Check for exact match with the specified value
  if (
    binaryExpression.operator === operator &&
    ((isProcessEnvNodeEnv(left) && isLiteral(right, value)) ||
      (isProcessEnvNodeEnv(right) && isLiteral(left, value)))
  ) {
    return true;
  }

  // For !== operator, also allow any other NODE_ENV comparison
  if (
    operator === '!==' &&
    (binaryExpression.operator === '===' || binaryExpression.operator === '!==') &&
    (isProcessEnvNodeEnv(left) || isProcessEnvNodeEnv(right))
  ) {
    return true;
  }

  return false;
}
