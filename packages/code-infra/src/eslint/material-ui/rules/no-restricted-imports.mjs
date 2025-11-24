import moduleVisitorModule from 'eslint-module-utils/moduleVisitor';
import { minimatch } from 'minimatch';

/**
 * @type {import('eslint-module-utils/moduleVisitor').default}
 */
const moduleVisitor = /** @type {any} */ (moduleVisitorModule).default || moduleVisitorModule;

/**
 * @typedef {Object} PatternConfig
 * @property {string} pattern - The glob pattern to match against import sources
 * @property {string} [message] - Custom message to show when the pattern matches
 */

/**
 * Creates an ESLint rule that restricts imports based on their source strings using glob patterns.
 * This is similar to ESLint's built-in no-restricted-imports but with more robust pattern matching.
 * Works with both ESM (import) and CommonJS (require) imports.
 *
 * @example
 * // In your eslint.config.mjs:
 * {
 *   rules: {
 *     'material-ui/no-restricted-imports': [
 *       'error',
 *       [
 *         {
 *           pattern: '@mui/material/*',
 *           message: 'Use the default import from @mui/material instead.'
 *         },
 *         {
 *           pattern: '@mui/*\/internal/**',
 *           message: 'Do not import from internal modules.'
 *         },
 *         {
 *           pattern: './**\/*.css'
 *         }
 *       ]
 *     ]
 *   }
 * }
 */
export default /** @type {import('eslint').Rule.RuleModule} */ ({
  meta: {
    docs: {
      description:
        'Disallow imports that match specified patterns. Use glob patterns to restrict imports by their source string.',
    },
    messages: {
      restrictedImport:
        'Importing from "{{importSource}}" is not allowed because it matches the pattern "{{pattern}}".{{customMessage}}',
    },
    type: 'suggestion',
    schema: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ],
  },
  create(context) {
    const options = context.options[0] || [];

    if (!Array.isArray(options) || options.length === 0) {
      return {};
    }

    return moduleVisitor(
      (/** @type {any} */ source, /** @type {any} */ node) => {
        const importSource = source.value;

        if (!importSource || typeof importSource !== 'string') {
          return;
        }

        // Check each pattern against the import source
        for (const option of options) {
          const { pattern, message = '' } = option;

          if (minimatch(importSource, pattern)) {
            context.report({
              node,
              messageId: 'restrictedImport',
              data: {
                importSource,
                pattern,
                customMessage: message ? ` ${message}` : '',
              },
            });

            // Stop after first match
            break;
          }
        }
      },

      { commonjs: true, esmodule: true },
    ); // This handles both require() and import statements
  },
});
