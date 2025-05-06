const baseline = require('@mui/monorepo/.eslintrc');
const path = require('path');

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
    'jsx-a11y/no-autofocus': 'off',
  },
  overrides: [...baseline.overrides],
};
