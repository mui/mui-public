/** @type {import('stylelint').Config} */
export default {
  extends: 'stylelint-config-standard',
  rules: {
    'alpha-value-notation': null,
    'custom-property-pattern': null,
    'media-feature-range-notation': null,
    'no-empty-source': null,
    'selector-class-pattern': null,
    'string-no-newline': null, // not compatible with prettier
    'value-keyword-case': null,
    'import-notation': null,
    'property-no-vendor-prefix': null,
    'comment-empty-line-before': ['always', { ignore: ['after-comment'] }],
  },
  overrides: [
    {
      files: ['**/*.?(c|m)[jt]s?(x)'],
      customSyntax: 'postcss-styled-syntax',
    },
  ],
};
