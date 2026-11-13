import { transformAsync } from '@babel/core';
import pluginReactPureAnnotations from '@babel/plugin-transform-react-pure-annotations';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';

const BABEL_FILES = /\.[cm]?[jt]sx?$/;
const TS_FILES = /\.[cm]?tsx?$/;
const TS_WITHOUT_JSX = /\.[cm]?ts$/;

/**
 * Runs the MUI Babel plugins that have no Oxc equivalent. Oxc then strips types, compiles JSX
 * and lowers syntax.
 * @param {import('../cli/packageJson').PackageJson} packageJson
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function babelPlugin(packageJson) {
  const dependencies = packageJson.dependencies ?? {};
  /** @type {import('@babel/core').PluginItem[]} */
  const plugins = [pluginDisplayName];
  if (dependencies['prop-types'] !== undefined) {
    plugins.push([pluginRemovePropTypes, { mode: 'unsafe-wrap' }]);
  }
  if (dependencies.clsx !== undefined || dependencies.classnames !== undefined) {
    plugins.push(pluginOptimizeClsx);
  }
  // Oxc only marks JSX as pure, not React calls such as `createContext()`.
  plugins.push(pluginReactPureAnnotations);

  return {
    name: 'code-infra:babel',
    transform: {
      filter: { id: { include: BABEL_FILES, exclude: /node_modules/ } },
      async handler(code, id) {
        /** @type {NonNullable<import('@babel/core').InputOptions['parserOpts']>['plugins']} */
        const syntax = [];
        if (TS_FILES.test(id)) {
          syntax.push('typescript');
        }
        if (!TS_WITHOUT_JSX.test(id)) {
          syntax.push('jsx');
        }
        const result = await transformAsync(code, {
          filename: id,
          configFile: false,
          babelrc: false,
          sourceMaps: true,
          parserOpts: { plugins: syntax },
          plugins,
        });
        if (!result?.code) {
          return null;
        }
        return {
          code: result.code,
          map: /** @type {import('tsdown').Rolldown.SourceMapInput} */ (result.map),
        };
      },
    },
  };
}
