import { isProcessEnvNodeEnv } from './nodeEnvUtils.mjs';

/**
 * Recursively checks if process.env.NODE_ENV appears anywhere in the node tree
 * @param {import('estree').Node | null | undefined} node
 * @returns {boolean}
 */
function containsProcessEnvNodeEnv(node) {
  if (!node || typeof node !== 'object') {
    return false;
  }

  if (isProcessEnvNodeEnv(node)) {
    return true;
  }

  // Traverse all child nodes, skipping parent references to avoid circular traversal
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const child = /** @type {unknown} */ (/** @type {any} */ (node)[key]);
    if (Array.isArray(child)) {
      if (child.some(containsProcessEnvNodeEnv)) {
        return true;
      }
    } else if (
      child &&
      typeof child === 'object' &&
      /** @type {import('estree').Node} */ (child).type
    ) {
      if (containsProcessEnvNodeEnv(/** @type {import('estree').Node} */ (child))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * ESLint rule that disallows throw statements guarded by process.env.NODE_ENV checks.
 *
 * NODE_ENV guards cause throw statements to only execute in certain environments,
 * leading to inconsistent control flow between development and production. Whether
 * the guard excludes production (tree-shaking the throw away) or targets production
 * specifically, the result is environment-dependent behavior that should be avoided.
 *
 * The rule stops at function boundaries, so throws inside functions defined within
 * a NODE_ENV guard are not flagged, as the function may be called from other contexts.
 *
 * @example
 * // Invalid - throw only in development, removed in production
 * if (process.env.NODE_ENV !== 'production') {
 *   throw new Error('Missing required prop');
 * }
 *
 * @example
 * // Invalid - throw only in production
 * if (process.env.NODE_ENV === 'production') {
 *   throw new Error('Production-only error');
 * }
 *
 * @example
 * // Valid - unconditional throw
 * throw new Error('Something went wrong');
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow throw statements guarded by process.env.NODE_ENV checks, as they cause environment-dependent control flow',
    },
    messages: {
      guardedThrow:
        'Do not guard `throw` statements with `process.env.NODE_ENV` checks. Guarded throws execute only in certain environments, causing inconsistent control flow between development and production.',
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
          if (
            current.type === 'FunctionDeclaration' ||
            current.type === 'FunctionExpression' ||
            current.type === 'ArrowFunctionExpression'
          ) {
            break;
          }
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
