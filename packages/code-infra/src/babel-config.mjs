import pluginTransformRuntime from '@babel/plugin-transform-runtime';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginReactCompiler from 'babel-plugin-react-compiler';
import pluginTransformImportMeta from 'babel-plugin-transform-import-meta';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';

/**
 * @typedef {'annotation' | 'syntax' | 'infer' | 'all'} ReactCompilationMode
 */

/**
 * Inlines reads of an allowlisted set of `process.env.*` variables with their
 * build-time string values.
 *
 * Vendored replacement for the unmaintained
 * `babel-plugin-transform-inline-environment-variables`, whose latest release
 * (0.4.4) relies on the `path.toComputedKey()` NodePath method that was removed
 * in Babel 8 (it now lives on `@babel/types` and only accepts method/property
 * nodes, not member expressions).
 *
 * @param {typeof import('@babel/core')} api
 * @returns {import('@babel/core').PluginObject}
 */
function pluginTransformInlineEnvVars({ types: t }) {
  return {
    name: 'transform-inline-environment-variables',
    visitor: {
      /**
       * @param {import('@babel/core').NodePath<import('@babel/core').types.MemberExpression>} path
       * @param {import('@babel/core').PluginPass} state
       */
      MemberExpression(path, state) {
        const { include, exclude } = /** @type {{ include?: string[], exclude?: string[] }} */ (
          state.opts
        );
        if (!path.get('object').matchesPattern('process.env')) {
          return;
        }
        const { node } = path;
        let key = node.property;
        if (!node.computed && t.isIdentifier(key)) {
          key = t.stringLiteral(key.name);
        }
        if (!t.isStringLiteral(key)) {
          return;
        }
        const isAssignmentTarget =
          t.isAssignmentExpression(path.parent) && path.parent.left === node;
        if (isAssignmentTarget) {
          return;
        }
        if (include && !include.includes(key.value)) {
          return;
        }
        if (exclude && exclude.includes(key.value)) {
          return;
        }
        path.replaceWith(t.valueToNode(process.env[key.value]));
      },
    },
  };
}

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
 * @param {ReactCompilationMode} [param0.reactCompilerMode]
 * @param {{ allowedCallees?: Record<string, string[]> }} [param0.displayName] - Options for the display name plugin.
 * @returns {import('@babel/core').InputOptions} The base Babel configuration.
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
  displayName,
}) {
  /**
   * @type {import('@babel/preset-env').Options}
   */
  const presetEnvOptions = {
    debug,
    modules: bundle === 'esm' ? false : 'commonjs',
    // @TODO
    browserslistEnv: bundle === 'esm' ? 'stable' : 'node',
  };
  /**
   * @type {import('@babel/core').PluginItem[]}
   */
  const plugins = [
    [
      pluginTransformRuntime,
      {
        version: runtimeVersion,
      },
      '@babel/plugin-transform-runtime',
    ],
    [pluginDisplayName, { ...displayName }, '@mui/internal-babel-plugin-display-name'],
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

  if (bundle !== 'esm') {
    plugins.push([pluginTransformImportMeta, {}, 'babel-plugin-transform-import-meta']);
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
    presets: [[presetEnv, presetEnvOptions], presetTypescript],
    plugins,
    overrides: [
      {
        // Babel 8's parser enables JSX for every file `@babel/preset-react` runs
        // on, which makes it misparse generic arrows such as `<T>(x) => x` in
        // plain `.ts` files. Scope the React preset (and therefore JSX parsing) to
        // the files that can actually contain JSX. `.ts`/`.mts`/`.cts` cannot.
        exclude: /\.[cm]?ts$/,
        presets: [[presetReact, { runtime: 'automatic' }]],
      },
    ],
  };
}

/**
 * @typedef {Object} Options
 * @prop {'esm' | 'cjs'} [Options.bundle]
 * @prop {boolean} [Options.noResolveImports]
 * @prop {undefined} [options.env]
 */

/**
 * @param {import('@babel/core').ConfigAPI | Options} api
 * @returns {import('@babel/core').InputOptions}
 */
export default function getBabelConfig(api) {
  /** @type {'esm' | 'cjs'} */
  let bundle;
  /** @type {boolean} */
  let noResolveImports;

  if (api.env) {
    // legacy
    bundle = api.env(['regressions', 'stable']) ? 'esm' : 'cjs';
    // eslint-disable-next-line mui/consistent-production-guard
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
    runtimeVersion: process.env.MUI_BABEL_RUNTIME_VERSION || '^7.25.0',
    optimizeClsx: process.env.MUI_OPTIMIZE_CLSX === 'true',
    removePropTypes: process.env.MUI_REMOVE_PROP_TYPES === 'true',
    noResolveImports,
    reactCompilerReactVersion: process.env.MUI_REACT_COMPILER_REACT_VERSION,
    reactCompilerMode: /** @type {ReactCompilationMode} */ (process.env.MUI_REACT_COMPILER_MODE),
  });
}
