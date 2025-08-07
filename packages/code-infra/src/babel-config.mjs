import pluginTransformRuntime from '@babel/plugin-transform-runtime';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginTransformInlineEnvVars from 'babel-plugin-transform-inline-environment-variables';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';

/**
 * @param {Object} param0
 * @param {boolean} [param0.debug]
 * @param {boolean} [param0.optimizeClsx]
 * @param {boolean} [param0.removePropTypes]
 * @param {'cjs' | 'esm'} param0.bundle
 * @param {string | null} param0.outExtension - Specify the output file extension.
 * @param {string} param0.runtimeVersion
 * @returns {import('@babel/core').TransformOptions} The base Babel configuration.
 */
export function getBaseConfig({
  debug = false,
  optimizeClsx = false,
  removePropTypes = false,
  bundle,
  runtimeVersion,
  outExtension,
}) {
  /**
   * @type {import('@babel/preset-env').Options}
   */
  const presetEnvOptions = {
    bugfixes: true,
    debug,
    modules: bundle === 'esm' ? false : 'commonjs',
    // @TODO
    browserslistEnv: bundle === 'esm' ? 'stable' : 'node',
  };
  /**
   * @type {import('@babel/core').TransformOptions["plugins"]}
   */
  const plugins = [
    [
      pluginTransformRuntime,
      {
        version: runtimeVersion,
        regenerator: false,
        useESModules: bundle === 'esm',
      },
    ],
    [pluginDisplayName],
    [
      pluginTransformInlineEnvVars,
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
  ];

  if (removePropTypes) {
    plugins.push([
      pluginRemovePropTypes,
      {
        mode: 'unsafe-wrap',
      },
    ]);
  }

  if (optimizeClsx) {
    plugins.push([pluginOptimizeClsx]);
  }

  if (bundle === 'esm') {
    plugins.push([pluginResolveImports, { outExtension }]);
  }

  return {
    assumptions: {
      noDocumentAll: true,
      // With our case these assumptions are safe, and the
      // resulting behavior is equivalent to spec mode.
      setPublicClassFields: true,
      privateFieldsAsProperties: true,
      objectRestNoSymbols: true,
      setSpreadProperties: true,
    },
    ignore: [
      // Fix a Windows issue.
      /@babel[\\|/]runtime/,
      // Fix const foo = /{{(.+?)}}/gs; crashing.
      /prettier/,
      '**/*.template.js',
    ],
    presets: [
      [presetEnv, presetEnvOptions],
      [
        presetReact,
        { runtime: 'automatic', useBuiltIns: bundle === 'esm', useSpread: bundle === 'esm' },
      ],
      [presetTypescript],
    ],
    plugins,
  };
}

/**
 * @type {import('@babel/core').ConfigFunction}
 */
export default function getBabelConfig(api) {
  // This needs to be called to bust caching between cjs and esm builds
  api.env();
  return getBaseConfig({
    debug: process.env.MUI_BUILD_VERBOSE === 'true',
    bundle: process.env.BABEL_ENV === 'stable' ? 'esm' : 'cjs',
    outExtension: process.env.MUI_OUT_FILE_EXTENSION ?? null,
    // any package needs to declare 7.25.0 as a runtime dependency. default is ^7.0.0
    runtimeVersion: process.env.MUI_BABEL_RUNTIME_VERSION || '^7.25.0',
    optimizeClsx: process.env.MUI_OPTIMIZE_CLSX === 'true',
    removePropTypes: process.env.MUI_REMOVE_PROP_TYPES === 'true',
  });
}
