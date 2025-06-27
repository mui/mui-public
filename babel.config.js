// copied from https://github.com/mui/material-ui/blob/master/babel.config.js
// defaultAlias modified
// @mui/internal-babel-plugin-minify-errors removed

// @ts-check
const path = require('path');

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
  const useESModules = api.env(['regressions', 'stable']);

  const defaultAlias = {
    '@mui/internal-docs-infra': resolveAliasPath('./packages/docs-infra/src'),
  };

  const presets = [
    [
      '@babel/preset-env',
      {
        bugfixes: true,
        browserslistEnv: api.env() || process.env.NODE_ENV,
        debug: process.env.MUI_BUILD_VERBOSE === 'true',
        modules: useESModules ? false : 'commonjs',
      },
    ],
    [
      '@babel/preset-react',
      {
        runtime: 'automatic',
      },
    ],
    '@babel/preset-typescript',
  ];

  // Essentially only replace in production builds.
  // When aliasing we want to keep the original extension
  const outFileExtension = process.env.MUI_OUT_FILE_EXTENSION || null;

  /** @type {babel.PluginItem[]} */
  const plugins = [
    'babel-plugin-optimize-clsx',
    [
      '@babel/plugin-transform-runtime',
      {
        useESModules,
        // any package needs to declare 7.25.0 as a runtime dependency. default is ^7.0.0
        version: process.env.MUI_BABEL_RUNTIME_VERSION || '^7.25.0',
      },
    ],
    [
      'babel-plugin-transform-react-remove-prop-types',
      {
        mode: 'unsafe-wrap',
      },
    ],
    [
      'transform-inline-environment-variables',
      {
        include: [
          'MUI_VERSION',
          'MUI_MAJOR_VERSION',
          'MUI_MINOR_VERSION',
          'MUI_PATCH_VERSION',
          'MUI_PRERELEASE',
        ],
      },
    ],
    ...(useESModules
      ? [
          [
            '@mui/internal-babel-plugin-resolve-imports',
            {
              outExtension: outFileExtension,
            },
          ],
        ]
      : []),
  ];

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
    assumptions: {
      noDocumentAll: true,
    },
    presets,
    plugins,
    ignore: [/@babel[\\|/]runtime/], // Fix a Windows issue.
    overrides: [
      {
        exclude: /\.test\.(m?js|ts|tsx)$/,
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
