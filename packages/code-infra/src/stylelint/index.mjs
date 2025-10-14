import postcssStylesSyntax from 'postcss-styled-syntax';
import standardConfig from 'stylelint-config-standard';

/** @type {import('stylelint').Config} */
export default {
  extends: standardConfig,
  rules: {
    // Too opinionated?
    'no-descending-specificity': null,

    // Adopted from mui/material-ui repo
    'alpha-value-notation': null,
    'custom-property-pattern': null,
    'media-feature-range-notation': null,
    'no-empty-source': null,
    'selector-class-pattern': null,
    'string-no-newline': null, // not compatible with prettier
    'value-keyword-case': null,
    'import-notation': null,

    // Responsibility of prettier:
    'at-rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,

    // Tailwind
    'at-rule-no-unknown': [true, { ignoreAtRules: ['theme', 'config'] }],

    // Don't assume we use a preprocessor
    'property-no-vendor-prefix': null,
    'property-no-deprecated': null,
    'declaration-property-value-keyword-no-deprecated': null,

    // Responsibility of a minifier
    'color-hex-length': null,
    'declaration-block-no-redundant-longhand-properties': null,
  },
  overrides: [
    {
      files: ['**/*.?(c|m)[jt]s?(x)'],
      customSyntax: /** @type {any} */ (postcssStylesSyntax),
    },
  ],
};
