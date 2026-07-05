// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
// copied from https://github.com/mui/material-ui/blob/master/babel.config.js
// @mui/internal-babel-plugin-minify-errors removed

const { default: getBaseConfig } = require('@mui/internal-code-infra/babel-config');

/**
 * @typedef {import('@babel/core')} babel
 */

/** @type {babel.ConfigFunction} */
module.exports = function getBabelConfig(api) {
  const baseConfig = getBaseConfig(api);

  return {
    ...baseConfig,
    plugins: [...(baseConfig.plugins ?? [])],
    overrides: [
      {
        // Reduces cold start time of tests. Hoisting the elements is also almost never intended for test files.
        // Context https://github.com/mui/material-ui/pull/26448
        exclude: /\.test\.(m?js|tsx)$/,
        plugins: ['@babel/plugin-transform-react-constant-elements'],
      },
      {
        test: /(\.test\.[^.]+$|\.test\/)/,
        plugins: [['@mui/internal-babel-plugin-resolve-imports', false]],
      },
    ],
  };
};
