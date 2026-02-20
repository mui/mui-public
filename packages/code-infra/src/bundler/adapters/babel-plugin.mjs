import rollupBabelPlugin from '@rollup/plugin-babel';
import * as semver from 'semver';

/**
 * @typedef {import('../types.mjs').BundlerConfig} BundlerConfig
 * @typedef {import('../types.mjs').Format} Format
 */

/**
 * @param {BundlerConfig} config
 * @param {{ format: Format }} options
 * @returns {import('rollup').Plugin}
 */
export function babelPlugin(config, options) {
  let babelRuntimeVersion = config.packageInfo.dependencies?.['@babel/runtime'] ?? '';
  if (babelRuntimeVersion === 'catalog:') {
    // @TODO: improve this by reading from the workspace package.json
    babelRuntimeVersion = '^7.25.0';
  }

  if (!babelRuntimeVersion) {
    throw new Error(
      'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
    );
  }
  let reactVersion = config.packageInfo.peerDependencies?.react || '';
  const mode = process.env.MUI_REACT_COMPILER_MODE || process.env.REACT_COMPILER_MODE;
  if (config.enableReactCompiler) {
    if (!reactVersion) {
      throw new Error(
        'When building with React compiler, "react" must be specified as a peerDependency in package.json.',
      );
    }
    reactVersion =
      reactVersion !== 'latest'
        ? (semver.minVersion(config.packageInfo.peerDependencies?.react || '')?.version ?? 'latest')
        : reactVersion;
    if (reactVersion === 'latest') {
      // Separate runtime package installation is not required from React 19 onwards
      reactVersion = '19.0.0';
    }
    if (
      semver.lt(reactVersion, '19.0.0') &&
      !config.packageInfo.peerDependencies?.['react-compiler-runtime'] &&
      !config.packageInfo.dependencies?.['react-compiler-runtime']
    ) {
      throw new Error(
        'When building with React compiler for React versions below 19, "react-compiler-runtime" must be specified as a dependency or peerDependency in package.json.',
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[feature] Building with React compiler enabled. The compiler mode is "${mode}" right now.${mode === 'opt-in' ? ' Use explicit "use memo" directives in your components to enable the React compiler for them.' : ''}`,
    );
  }
  return /** @type {import('rollup').Plugin} */ (
    rollupBabelPlugin({
      babelHelpers: 'runtime',
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.cjs', '.cts'],
      skipPreflightCheck: true,
      configFile: config.babelConfigPath,
      parserOpts: {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      },
      envName: options.format === 'cjs' ? 'node' : 'stable',
      caller: /** @type {any} */ ({
        name: 'code-infra-bundler',
        babelRuntimeVersion,
        reactCompilerReactVersion: config.enableReactCompiler ? reactVersion : undefined,
        reactCompilerMode: mode,
        optimizeClsx:
          config.packageInfo.dependencies?.clsx !== undefined ||
          config.packageInfo.dependencies?.classnames !== undefined,
        removePropTypes: config.packageInfo.dependencies?.['prop-types'] !== undefined,
      }),
    })
  );
}
