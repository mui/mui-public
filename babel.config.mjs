// @ts-check
// copied from https://github.com/mui/material-ui/blob/master/babel.config.js
// defaultAlias modified
// @mui/internal-babel-plugin-minify-errors removed

import * as path from 'node:path';
import getBaseConfig from '@mui/internal-code-infra/babel-config';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {import('@babel/core')} babel
 */

const dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * @param {string} relativeToBabelConf
 * @returns {string}
 */
function resolveAliasPath(relativeToBabelConf) {
  const resolvedPath = path.relative(process.cwd(), path.resolve(dirname, relativeToBabelConf));
  return `./${resolvedPath.replace('\\', '/')}`;
}

/** @type {babel.ConfigFunction} */
export default function getBabelConfig(api) {
  const baseConfig = getBaseConfig(api);

  const defaultAlias = {
    '@mui/internal-docs-infra': resolveAliasPath('./packages/docs-infra/src'),
  };

  const plugins = [];

  if (process.env.NODE_ENV === 'test') {
    plugins.push([
      'babel-plugin-module-resolver',
      {
        alias: defaultAlias,
        root: ['./'],
      },
    ]);
  }

  return {
    ...baseConfig,
    plugins: [...(baseConfig.plugins ?? []), ...plugins],
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
}
