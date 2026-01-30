import { isProcessEnvNodeEnv } from './nodeEnvUtils.mjs';

/**
 * Recursively checks if process.env.NODE_ENV appears anywhere in the node tree
 * @param {import('estree').Node | null | undefined} node
 * @returns {boolean}
 */
function containsProcessEnvNodeEnv(node) {
  if (!node || typeof node !== 'object') return false;

  if (isProcessEnvNodeEnv(node)) return true;

  // Traverse all child nodes, skipping parent references to avoid circular traversal
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = /** @type {unknown} */ (node)[key];
    if (Array.isArray(child)) {
      if (child.some(containsProcessEnvNodeEnv)) return true;
    } else if (child && typeof child === 'object' && /** @type {import('estree').Node} */ (child).type) {
      if (containsProcessEnvNodeEnv(/** @type {import('estree').Node} */ (child))) return true;
    }
  }
  return false;
}

/**
 * ESLint rule that disallows throw statements guarded by process.env.NODE_ENV checks.
 *
 * Throw statements inside NODE_ENV conditionals get tree-shaken out of production
 * bundles, which can lead to differences in control flow between development and production
 * environments. This rule ensures that throw statements are unconditional, maintaining
 * consistent behavior across environments.
 *
 * @example
 * // Valid - unconditional throw
 * throw new Error('Something went wrong');
 *
 * @example
 * // Invalid - guarded throw will be removed in production
 * if (process.env.NODE_ENV !== 'production') {
 *   throw new Error('Missing required prop');
 * }
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow throw statements inside process.env.NODE_ENV conditional blocks',
    },
    messages: {
      guardedThrow:
        'Do not guard `throw` statements with `process.env.NODE_ENV` checks. Throw statements should not be tree-shaken out of production bundles to avoid differences in control flow between environments.',
    },
    schema: [],
  },
  create(context) {
    return {
      ThrowStatement(node) {
        /** @type {import('eslint').Rule.Node | null} */
        let current = node.parent;
        /** @type {import('eslint').Rule.Node} */
        let currentChild = node;

        while (current) {
          if (current.type === 'IfStatement') {
            const isInConsequent = current.consequent === currentChild;
            const isInAlternate = current.alternate === currentChild;

            if ((isInConsequent || isInAlternate) && containsProcessEnvNodeEnv(current.test)) {
              context.report({ node, messageId: 'guardedThrow' });
              return;
            }
          }
          currentChild = current;
          current = current.parent;
        }
      },
    };
  },
};

export default rule;
