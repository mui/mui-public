import prettier from 'eslint-config-prettier/flat';
import reactCompilerPlugin from 'eslint-plugin-react-compiler';
import { configs as reactHookConfigs } from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';

import { airbnbBaseConfig, airbnbReactConfig } from './airbnb/base.mjs';
import airbnbTypescript from './airbnb/typescript.mjs';
import { createCoreConfig } from './material-ui/config.mjs';
import muiPlugin from './material-ui/index.mjs';
/**
 * @param {Object} [params]
 * @param {boolean} [params.enableReactCompiler] - Whether the config is for spec files.
 * @param {string} [params.baseDirectory] - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig({ enableReactCompiler = false } = {}) {
  return /** @type {import('eslint').Linter.Config[]} */ (
    tseslint.config(
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
    )
  );
}
