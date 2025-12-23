import { transformAsync } from '@babel/core';

/**
 * @param {Object} options
 * @param {string} [options.root]
 * @param {string} [options.verbose]
 * @param {boolean} [options.optimizeClsx]
 * @param {boolean} [options.removePropTypes]
 * @param {string} [options.babelRuntimeVersion]
 * @param {Object} [options.reactCompiler] - Whether to use the React compiler.
 * @param {string} [options.reactCompiler.reactVersion] - The React version to use with the React compiler.
 * @returns {import('rolldown').Plugin}
 */
export default function tsdownBabel(options) {
  return {
    name: 'tsdown-plugin-babel',
    buildStart() {
      const reactVersion = options.reactCompiler?.reactVersion;
      if (options.verbose) {
        process.env.MUI_BUILD_VERBOSE = 'true';
      }
      process.env.MUI_IS_TSDOWN_BABEL = 'true';
      if (options.optimizeClsx) {
        process.env.MUI_OPTIMIZE_CLSX = 'true';
      }
      if (options.removePropTypes) {
        process.env.MUI_REMOVE_PROP_TYPES = 'true';
      }
      if (options.babelRuntimeVersion) {
        process.env.MUI_BABEL_RUNTIME_VERSION = options.babelRuntimeVersion;
      }
      process.env.NODE_ENV = 'production';
      if (reactVersion) {
        process.env.MUI_REACT_COMPILER = reactVersion ? '1' : '0';
        process.env.MUI_REACT_COMPILER_REACT_VERSION = reactVersion;
      }
    },
    buildEnd() {
      delete process.env.MUI_BUILD_VERBOSE;
      delete process.env.MUI_IS_TSDOWN_BABEL;
      delete process.env.MUI_OPTIMIZE_CLXS;
      delete process.env.MUI_REMOVE_PROP_TYPES;
      delete process.env.MUI_BABEL_RUNTIME_VERSION;
      delete process.env.MUI_REACT_COMPILER;
      delete process.env.MUI_REACT_COMPILER_REACT_VERSION;
      delete process.env.NODE_ENV;
    },
    transform: {
      filter: [
        {
          kind: 'include',
          expr: {
            kind: 'and',
            args: [
              {
                kind: 'or',
                args: [
                  {
                    kind: 'moduleType',
                    pattern: 'js',
                  },
                  {
                    kind: 'moduleType',
                    pattern: 'jsx',
                  },
                  {
                    kind: 'moduleType',
                    pattern: 'ts',
                  },
                  {
                    kind: 'moduleType',
                    pattern: 'tsx',
                  },
                ],
              },
              {
                kind: 'not',
                expr: {
                  kind: 'id',
                  pattern: /\.d\.ts$/,
                  params: {},
                },
              },
            ],
          },
        },
      ],
      order: 'pre',
      async handler(code, id) {
        const filename = id.split('?')[0];
        const isJsx = filename.endsWith('x');
        const isTs = /\.tsx?$/.test(filename);
        /**
         * @type {string[]}
         */
        const parserPlugins = [];
        if (isJsx) {
          parserPlugins.push('jsx');
        }
        if (isTs) {
          parserPlugins.push('typescript');
        }
        const result = await transformAsync(code, {
          root: options.root ?? process.cwd(),
          sourceFileName: filename,
          filename,
          configFile: true,
          parserOpts: {
            sourceType: 'module',
            allowAwaitOutsideFunction: true,
            // @ts-expect-error This is valid as per babel
            plugins: parserPlugins,
          },
          // @ts-expect-error This is valid as per babel
          envName: this.outputOptions?.format === 'cjs' ? 'node' : 'stable',
        });
        if (result) {
          return { code: result.code ?? '', map: result.map ?? undefined };
        }
        return null;
      },
    },
  };
}
