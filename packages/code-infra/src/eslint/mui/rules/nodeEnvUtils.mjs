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

/**
 * Checks if a BinaryExpression compares process.env.NODE_ENV with === or !==
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
export function isNodeEnvBinaryComparison(node) {
  return (
    node.type === 'BinaryExpression' &&
    (node.operator === '===' || node.operator === '!==') &&
    (isProcessEnvNodeEnv(node.left) || isProcessEnvNodeEnv(node.right))
  );
}

/**
 * Walks up the parent chain and checks if the node is inside an IfStatement
 * whose test is a NODE_ENV binary comparison.
 * If a callback is provided, it is called with the IfStatement and the direct
 * child that leads to the node. The function returns true only when the callback
 * returns true. Without a callback the function returns true when the node is
 * inside any branch (consequent or alternate) of such an IfStatement.
 * @param {import('eslint').Rule.Node} node
 * @param {(ifStatement: import('estree').IfStatement & import('eslint').Rule.NodeParentExtension, child: import('eslint').Rule.Node) => boolean} [callback]
 * @returns {boolean}
 */
export function isInsideNodeEnvCheck(node, callback) {
  /** @type {import('eslint').Rule.Node | null} */
  let current = node.parent;
  /** @type {import('eslint').Rule.Node} */
  let currentChild = node;

  while (current) {
    if (current.type === 'IfStatement' && isNodeEnvBinaryComparison(current.test)) {
      if (callback) {
        if (callback(current, currentChild)) {
          return true;
        }
      } else {
        const isInConsequent = current.consequent === currentChild;
        const isInAlternate = current.alternate === currentChild;
        if (isInConsequent || isInAlternate) {
          return true;
        }
      }
    }

    currentChild = current;
    current = current.parent;
  }

  return false;
}
