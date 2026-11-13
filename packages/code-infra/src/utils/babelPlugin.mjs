import { transformAsync } from '@babel/core';

const BABEL_FILES = /\.[cm]?[jt]sx?$/;
const TS_FILES = /\.[cm]?tsx?$/;
const TS_WITHOUT_JSX = /\.[cm]?ts$/;

/** @type {NonNullable<import('@babel/core').InputOptions['caller']> & { compiler: import('../babel-config.mjs').Compiler }} */
const CALLER = { name: 'code-infra build-new', compiler: 'oxc' };

/**
 * Runs a Babel config in `oxc` mode: `getBaseConfig` keeps only the plugins Oxc has no
 * equivalent for, and the config file adds its own. Oxc then strips types, compiles JSX and
 * lowers syntax.
 * @param {string} configFile
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function babelPlugin(configFile) {
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
          configFile,
          babelrc: false,
          caller: CALLER,
          sourceMaps: true,
          parserOpts: { plugins: syntax },
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
