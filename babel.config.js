// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
// copied from https://github.com/mui/material-ui/blob/master/babel.config.js
// defaultAlias modified
// @mui/internal-babel-plugin-minify-errors removed

const path = require('node:path');
const { default: getBaseConfig } = require('@mui/internal-code-infra/babel-config');

/**
 * @typedef {import('@babel/core')} babel
 */

/**
 * @param {string} relativeToBabelConf
 * @returns {string}
 */
function resolveAliasPath(relativeToBabelConf) {
  const resolvedPath = path.relative(process.cwd(), path.resolve(__dirname, relativeToBabelConf));
  return `./${resolvedPath.replace('\\', '/')}`;
}

/** @type {babel.ConfigFunction} */
module.exports = function getBabelConfig(api) {
  const baseConfig = getBaseConfig(api);

  const defaultAlias = {
    '@mui/internal-docs-infra': resolveAliasPath('./packages/docs-infra/src'),
  };

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
    env: {
      coverage: {
        plugins: [
          'babel-plugin-istanbul',
          [
            'babel-plugin-module-resolver',
            {
              root: ['./'],
              alias: defaultAlias,
            },
          ],
        ],
      },
      development: {
        plugins: [
          [
            'babel-plugin-module-resolver',
            {
              alias: {
                ...defaultAlias,
                modules: './modules',
              },
              root: ['./'],
            },
          ],
        ],
      },
      test: {
        sourceMaps: 'both',
        plugins: [
          [
            'babel-plugin-module-resolver',
            {
              root: ['./'],
              alias: defaultAlias,
            },
          ],
        ],
      },
    },
  };
};
