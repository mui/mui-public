/**
 * @typedef {Exclude<import('prettier').Config['overrides'], undefined>[number]} Override
 */

/**
 * @type {Override[]}
 */
export const docsOverrides = [
  {
    files: [
      'docs/**/*.md',
      'docs/src/pages/**/*.{js,tsx}',
      'docs/src/app/**/*.{js,tsx}',
      'docs/data/**/*.{js,tsx}',
    ],
    options: {
      // otherwise code blocks overflow on the docs website
      // The container is 751px
      printWidth: 85,
    },
  },
];

/**
 * @type {Override}
 */
const jsonOverride = {
  files: ['**/*.json'],
  options: {
    trailingComma: 'none',
  },
};

/**
 * @param {Object} [options={}]
 * @param {Override[]} [options.overrides]
 * @returns {import('prettier').Config}
 */
export function createBaseConfig(options = {}) {
  return {
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'all',
    overrides: [jsonOverride, ...(options.overrides ?? [])],
  };
}
