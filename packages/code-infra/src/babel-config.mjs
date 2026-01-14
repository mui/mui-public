import pluginTransformRuntime from '@babel/plugin-transform-runtime';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginReactCompiler from 'babel-plugin-react-compiler';
import pluginTransformInlineEnvVars from 'babel-plugin-transform-inline-environment-variables';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';

/**
 * @param {Object} param0
 * @param {boolean} [param0.debug]
 * @param {boolean} [param0.optimizeClsx]
 * @param {boolean} [param0.removePropTypes]
 * @param {boolean} [param0.noResolveImports]
 * @param {'cjs' | 'esm'} param0.bundle
 * @param {string | null} param0.outExtension - Specify the output file extension.
 * @param {string} param0.runtimeVersion
 * @param {string} [param0.reactCompilerReactVersion]
 * @param {string} [param0.reactCompilerMode]
 * @param {boolean} [param0.isTsdownBundler=false]
 * @returns {import('@babel/core').TransformOptions} The base Babel configuration.
 */
export function getBaseConfig({
  debug = false,
  optimizeClsx = false,
  removePropTypes = false,
  noResolveImports = false,
  bundle,
  runtimeVersion,
  outExtension,
  reactCompilerReactVersion,
  reactCompilerMode,
  isTsdownBundler = false,
}) {
  /**
   * @type {import('@babel/preset-env').Options}
   */
  const presetEnvOptions = {
    bugfixes: true,
    debug,
    // eslint-disable-next-line no-nested-ternary
    modules: isTsdownBundler ? 'auto' : bundle === 'esm' ? false : 'commonjs',
    // @TODO
    // eslint-disable-next-line no-nested-ternary
    browserslistEnv: isTsdownBundler ? 'node' : bundle === 'esm' ? 'stable' : 'node',
  };
  /**
   * @type {([import('@babel/core').PluginTarget, import('@babel/core').PluginOptions, string | undefined])[]}
   */
  let plugins = [
    [
      pluginTransformRuntime,
      {
        version: runtimeVersion,
        regenerator: false,
        useESModules: bundle === 'esm',
      },
      '@babel/plugin-transform-runtime',
    ],
    [pluginDisplayName, {}, '@mui/internal-babel-plugin-display-name'],
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
      'babel-plugin-transform-inline-environment-variables',
    ],
  ];

  if (isTsdownBundler) {
    plugins = plugins.filter(
      ([, , pluginName]) => pluginName !== 'babel-plugin-transform-inline-environment-variables',
    );
  }

  if (reactCompilerReactVersion) {
    /**
     * @typedef {import('babel-plugin-react-compiler').PluginOptions} ReactCompilerOptions
     */
    /** @type {ReactCompilerOptions} */
    const reactCompilerOptions = {
      target: /** @type {ReactCompilerOptions["target"]} */ (
        reactCompilerReactVersion.split('.')[0] // comes from the package's peerDependencies
      ),
      enableReanimatedCheck: false,
      compilationMode: reactCompilerMode ?? 'annotation',
      // Skip components with errors instead of failing the build
      panicThreshold: 'none',
    };
    // The plugin must be the first one to run
    plugins.unshift([pluginReactCompiler, reactCompilerOptions, 'babel-plugin-react-compiler']);
  }

  if (removePropTypes) {
    plugins.push([
      pluginRemovePropTypes,
      {
        mode: 'unsafe-wrap',
      },
      'babel-plugin-transform-react-remove-prop-types',
    ]);
  }

  if (optimizeClsx) {
    plugins.push([pluginOptimizeClsx, {}, 'babel-plugin-optimize-clsx']);
  }

  if (bundle === 'esm' && !noResolveImports) {
    plugins.push([
      pluginResolveImports,
      { outExtension },
      '@mui/internal-babel-plugin-resolve-imports',
    ]);
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
    presets: (() => {
      const presets = [
        [presetEnv, presetEnvOptions],
        [
          presetReact,
          {
            runtime: 'automatic',
            useBuiltIns: isTsdownBundler || bundle === 'esm',
            useSpread: isTsdownBundler || bundle === 'esm',
          },
        ],
      ];
      if (!isTsdownBundler) {
        presets.push([presetTypescript]);
      }
      return presets;
    })(),
    plugins,
  };
}

/**
 * @typedef {Object} Options
 * @prop {'esm' | 'cjs'} [Options.bundle]
 * @prop {boolean} [Options.noResolveImports]
 * @prop {undefined} [options.env]
 * @prop {string} [options.bundler]
 */

/**
 * @param {import('@babel/core').ConfigAPI | Options} api
 * @returns {import('@babel/core').TransformOptions}
 */
export default function getBabelConfig(api) {
  /** @type {'esm' | 'cjs'} */
  let bundle;
  /** @type {boolean} */
  let noResolveImports;
  let isTsdownBundler = false;
  let babelRuntimeVersion = process.env.MUI_BABEL_RUNTIME_VERSION || '^7.25.0';
  let optimizeClsx = process.env.MUI_OPTIMIZE_CLSX === 'true';
  let removePropTypes = process.env.MUI_REMOVE_PROP_TYPES === 'true';
  let reactCompilerReactVersion = process.env.MUI_REACT_COMPILER_REACT_VERSION;
  let reactCompilerMode = process.env.MUI_REACT_COMPILER_MODE;

  if (typeof api === 'object') {
    if ('caller' in api && api.caller) {
      api.caller((caller) => {
        if (!caller) {
          return false;
        }
        if (caller?.name === 'tsdown-bundler') {
          isTsdownBundler = true;
        }
        const typedCaller = /** @type {Record<string, any>} */ (caller);
        if (typedCaller.optimizeClsx) {
          optimizeClsx = true;
        }
        if (typedCaller.removePropTypes) {
          removePropTypes = true;
        }
        if (typedCaller.reactCompilerReactVersion) {
          reactCompilerReactVersion = typedCaller.reactCompilerReactVersion;
        }
        if (typedCaller.reactCompilerMode) {
          reactCompilerMode = typedCaller.reactCompilerMode;
        }
        if (typedCaller.babelRuntimeVersion) {
          babelRuntimeVersion = typedCaller.babelRuntimeVersion;
        }
        return true;
      });
    } else if ('bundler' in api) {
      isTsdownBundler = api.bundler === 'tsdown-bundler';
    }
  }

  if (api.env) {
    // legacy
    bundle = api.env(['regressions', 'stable']) ? 'esm' : 'cjs';
    noResolveImports = api.env('test') || process.env.NODE_ENV === 'test';
  } else {
    bundle = api.bundle || 'esm';
    noResolveImports = api.noResolveImports || false;
  }

  return getBaseConfig({
    debug: process.env.MUI_BUILD_VERBOSE === 'true',
    bundle,
    outExtension: process.env.MUI_OUT_FILE_EXTENSION || null,
    // any package needs to declare 7.25.0 as a runtime dependency. default is ^7.0.0
    runtimeVersion: babelRuntimeVersion,
    optimizeClsx,
    removePropTypes,
    noResolveImports: isTsdownBundler ? false : noResolveImports,
    reactCompilerReactVersion,
    reactCompilerMode,
    isTsdownBundler,
  });
}
