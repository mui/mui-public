import { isInsideNodeEnvCheck } from './nodeEnvUtils.mjs';

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
        if (isInsideNodeEnvCheck(node)) {
          context.report({
            node,
            messageId: 'guardedThrow',
          });
        }
      },
    };
  },
};

export default rule;
