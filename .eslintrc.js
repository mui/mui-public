const baseline = require('@mui/monorepo/.eslintrc');

module.exports = {
  ...baseline,
  settings: {
    'import/resolver': {
      typescript: {
        project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
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
