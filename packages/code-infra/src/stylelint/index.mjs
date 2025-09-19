// @ts-expect-error No types available
import postcssStylesSyntax from 'postcss-styled-syntax';

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

    // Tailwind
    'at-rule-no-unknown': [true, { ignoreAtRules: ['theme', 'config'] }],

    // Allow commenting code out without forcing an empty line
    'comment-empty-line-before': [
      'always',
      { except: ['first-nested'], ignore: ['after-comment', 'stylelint-commands'] },
    ],

    // Don't assume we preprocess
    'property-no-vendor-prefix': null,
    'declaration-property-value-keyword-no-deprecated': null,

    // Work for a minifier
    'color-hex-length': null,
    'declaration-block-no-redundant-longhand-properties': null,
  },
  overrides: [
    {
      files: ['**/*.?(c|m)[jt]s?(x)'],
      customSyntax: postcssStylesSyntax,
    },
  ],
};
