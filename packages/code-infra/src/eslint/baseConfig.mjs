import { includeIgnoreFile } from '@eslint/compat';
import prettier from 'eslint-config-prettier/flat';
import reactCompilerPlugin from 'eslint-plugin-react-compiler';
import { configs as reactHookConfigs } from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { airbnbBaseConfig, airbnbReactConfig } from './airbnb/base.mjs';
import airbnbTypescript from './airbnb/typescript.mjs';
import { createCoreConfig } from './material-ui/config.mjs';
import muiPlugin from './material-ui/index.mjs';
/**
 * @param {Object} [params]
 * @param {boolean} [params.enableReactCompiler] - Whether the config is for spec files.
 * @param {string} params.baseDirectory - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig(
  { enableReactCompiler = false, baseDirectory } = { baseDirectory: process.cwd() },
) {
  const ignoreRules = /** @type {import('@eslint/compat').FlatConfig[]} */ (
    // All repos should use .lintignore going forward.
    // .eslintignore is for backward compatibility. Should be removed in future.
    ['.gitignore', '.lintignore', '.eslintignore']
      .map((file) => {
        if (fs.existsSync(`${baseDirectory}/${file}`)) {
          return includeIgnoreFile(path.join(baseDirectory, file), `Ignore rules from ${file}`);
        }
        return null;
      })
      .filter(Boolean)
  );

  return /** @type {import('eslint').Linter.Config[]} */ (
    tseslint.config(
      ...ignoreRules,
      airbnbBaseConfig,
      airbnbReactConfig,
      airbnbTypescript,
      reactHookConfigs.recommended,
      enableReactCompiler ? reactCompilerPlugin.configs.recommended : {},
      prettier,
      {
        name: 'typescript-eslint-parser',
        languageOptions: {
          parser: tseslint.parser,
          ecmaVersion: 7,
          globals: {
            ...globals.es2020,
            ...globals.browser,
            ...globals.node,
          },
        },
        plugins: {
          '@typescript-eslint': tseslint.plugin,
          'material-ui': muiPlugin,
        },
        settings: {
          'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx'],
          },
          'import/resolver': {
            typescript: {
              project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
            },
          },
        },
        extends: createCoreConfig({ reactCompilerEnabled: enableReactCompiler }),
      },
      {
        files: ['**/*.mjs'],
        rules: {
          'import/extensions': [
            'error',
            'ignorePackages',
            {
              js: 'always',
              mjs: 'always',
            },
          ],
        },
      },

      // Lint rule to disallow usage of typescript namespaces.We've seen at least two problems with them:
      //   * Creates non-portable types in base ui. [1]
      //   * This pattern [2] leads to broken bundling in codesandbox [3].
      // Gauging the ecosystem it also looks like support for namespaces in tooling is poor and tends to
      // be treated as a deprecated feature.
      // [1] https://github.com/mui/base-ui/pull/2324
      // [2] https://github.com/mui/mui-x/blob/1cf853ed45cf301211ece1c0ca21981ea208edfb/packages/x-virtualizer/src/models/core.ts#L4-L10
      // [3] https://codesandbox.io/embed/kgylpd?module=/src/Demo.tsx&fontsize=12
      {
        rules: {
          '@typescript-eslint/no-namespace': 'error',
        },
      },
    )
  );
}
