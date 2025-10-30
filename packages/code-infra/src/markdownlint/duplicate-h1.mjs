/**
 * @typedef {[string, string]} Attr
 */

/**
 * @typedef {Object} Token
 * @property {string} type
 * @property {string} info
 * @property {string} tag
 * @property {string} content
 * @property {number} lineNumber
 * @property {Attr[]} attrs
 */

/**
 * @typedef {Object} OnErrorObj
 * @property {number} lineNumber
 * @property {string} [detail]
 */

/**
 * @typedef {(err: OnErrorObj) => void} OnError
 */

/**
 * @typedef {Object} MdParams
 * @property {string} name
 * @property {string[]} lines
 * @property {Token[]} tokens
 */

// This rule is an extension of MD025/no-multiple-top-level-headings.
// The rule is buggy https://github.com/DavidAnson/markdownlint/pull/1109
// but also blog headers don't tell you that h1 is already injected.
export default {
  names: ['duplicateH1'],
  description: 'Multiple top-level headings in the same document.',
  tags: ['headings'],
  /**
   * @param {MdParams} params
   * @param {OnError} onError
   */
  function: (params, onError) => {
    /**
     * @type {number|boolean}
     */
    let hasTopLevelHeading = false;
    params.tokens.forEach((token) => {
      if (token.type === 'heading_open' && token.tag === 'h1') {
        // Avoid duplicate errors with MD025.
        if (hasTopLevelHeading !== false && hasTopLevelHeading !== 1) {
          onError({
            lineNumber: token.lineNumber,
          });
        } else if (params.name.includes('/docs/pages/blog/')) {
          onError({
            lineNumber: token.lineNumber,
            detail: 'In the blog, the h1 is already added using the markdown header.title value.',
          });
        }

        // Store the first h1 of the page.
        if (hasTopLevelHeading === false) {
          hasTopLevelHeading = token.lineNumber;
        }
      }
    });
  },
};
