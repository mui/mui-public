/**
 * Rollup plugin that replaces Rollup's inline interop helper functions
 * with imports from @babel/runtime/helpers.
 *
 * This allows deduplication of interop helpers across multiple output files
 * by using the shared @babel/runtime package.
 */

/**
 * @typedef {Object} InteropHelperConfig
 * @property {RegExp} pattern - Regex to match the inline helper function
 * @property {string} helperName - Name of the helper function
 * @property {string} runtimeHelper - Path to the @babel/runtime helper
 */

/** @type {InteropHelperConfig[]} */
const INTEROP_HELPERS = [
  {
    // interop: 'compat' generates _interopNamespaceCompat
    pattern: /function _interopNamespaceCompat\(e\) \{[\s\S]*?\n\}/,
    helperName: '_interopNamespaceCompat',
    runtimeHelper: '@babel/runtime/helpers/interopRequireWildcard',
  },
  {
    // interop: 'auto' or default generates _interopNamespaceDefault
    pattern: /function _interopNamespaceDefault\(e\) \{[\s\S]*?\n\}/,
    helperName: '_interopNamespaceDefault',
    runtimeHelper: '@babel/runtime/helpers/interopRequireWildcard',
  },
  {
    // interop: 'auto' generates _interopNamespace
    pattern: /function _interopNamespace\(e\) \{[\s\S]*?\n\}/,
    helperName: '_interopNamespace',
    runtimeHelper: '@babel/runtime/helpers/interopRequireWildcard',
  },
];

/**
 * @returns {import('rollup').Plugin}
 */
export function babelRuntimeInteropPlugin() {
  return {
    name: 'babel-runtime-interop',
    // Run after Rollup generates the output
    renderChunk(code, chunk, options) {
      if (options.format !== 'cjs') {
        return null;
      }

      let transformedCode = code;
      let hasChanges = false;

      for (const helper of INTEROP_HELPERS) {
        if (helper.pattern.test(transformedCode)) {
          hasChanges = true;

          // Remove the inline function definition
          transformedCode = transformedCode.replace(helper.pattern, '');

          // Add the require statement at the top (after 'use strict' if present)
          const requireStatement = `var ${helper.helperName} = require("${helper.runtimeHelper}")["default"];\n`;
          transformedCode = addRequireAfterUseStrict(transformedCode, requireStatement);
        }
      }

      if (!hasChanges) {
        return null;
      }

      // Clean up any extra blank lines from removed functions
      transformedCode = transformedCode.replace(/\n{3,}/g, '\n\n');

      return {
        code: transformedCode,
        map: null, // We're not tracking source maps for this simple transformation
      };
    },
  };
}

/**
 * Add a require statement after 'use strict' directive if present,
 * otherwise at the beginning of the file (after any banner comment).
 * @param {string} code
 * @param {string} requireStatement
 * @returns {string}
 */
function addRequireAfterUseStrict(code, requireStatement) {
  // Check if the require is already present
  if (code.includes(requireStatement.trim())) {
    return code;
  }

  // Try to insert after 'use strict'
  const useStrictMatch = code.match(/(['"])use strict\1;?\n/);
  if (useStrictMatch?.index !== undefined) {
    const insertPos = useStrictMatch.index + useStrictMatch[0].length;
    return code.slice(0, insertPos) + requireStatement + code.slice(insertPos);
  }

  // Try to insert after banner comment (/** ... */)
  const bannerMatch = code.match(/^\/\*\*[\s\S]*?\*\/\n*/);
  if (bannerMatch) {
    const insertPos = bannerMatch[0].length;
    return code.slice(0, insertPos) + requireStatement + code.slice(insertPos);
  }

  // Insert at the beginning
  return requireStatement + code;
}
