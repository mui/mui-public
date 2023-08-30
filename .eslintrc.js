const path = require('path');
const baseline = require('@mui/monorepo/.eslintrc');

module.exports = {
  ...baseline,
  settings: {
    'import/resolver': {
      webpack: {
        config: path.join(__dirname, './webpackBaseConfig.js'),
      },
    },
  },
  /**
   * Sorted alphanumerically within each group. built-in and each plugin form
   * their own groups.
   */
  rules: {
    ...baseline.rules,
    // No time for this
    'react/prop-types': 'off',
    'jsx-a11y/control-has-associated-label': 'off',
    // No time for this
    'jsx-a11y/no-autofocus': 'off',
  },
  overrides: [
    ...baseline.overrides,
    {
      files: [
        // matching the pattern of the test runner
        'accounting/**',
        'lambda/**',
        'BI/**',
        'web/**',
      ],
      rules: {
        'no-console': 'off',
        'import/no-unresolved': 'off',
      },
    },
  ],
};
