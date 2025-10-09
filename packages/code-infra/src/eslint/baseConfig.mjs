import { includeIgnoreFile } from '@eslint/compat';
import eslintJs from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import { configs as reactCompilerPluginConfigs } from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as path from 'node:path';
import * as tseslint from 'typescript-eslint';
import { createCoreConfig } from './material-ui/config.mjs';
import muiPlugin from './material-ui/index.mjs';
import { EXTENSION_TS } from './extensions.mjs';
import { createJsonConfig } from './jsonConfig.mjs';

/**
 * @param {Object} [params]
 * @param {boolean} [params.enableReactCompiler] - Whether the config is for spec files.
 * @param {string} [params.baseDirectory] - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig({
  enableReactCompiler = false,
  baseDirectory = process.cwd(),
} = {}) {
  return defineConfig([
    includeIgnoreFile(path.join(baseDirectory, '.lintignore'), `Ignore rules from .lintignore`),
    createJsonConfig(),
    prettier,
    {
      files: [`**/*.${EXTENSION_TS}`],
      extends: defineConfig([
        eslintJs.configs.recommended,
        importPlugin.flatConfigs.recommended,
        importPlugin.flatConfigs.react,
        jsxA11yPlugin.flatConfigs.recommended,
        reactPlugin.configs.flat.recommended,
        // @ts-expect-error Types are messed up https://github.com/facebook/react/issues/34705
        reactHooks.configs['flat/recommended'],
        tseslint.configs.recommended,
        importPlugin.flatConfigs.typescript,
        enableReactCompiler ? reactCompilerPluginConfigs.recommended : {},
        {
          name: 'typescript-eslint-parser',
          languageOptions: {
            ecmaVersion: 7,
            globals: {
              ...globals.es2020,
              ...globals.browser,
              ...globals.node,
            },
          },
          plugins: {
            'material-ui': muiPlugin,
          },
          extends: createCoreConfig({ reactCompilerEnabled: enableReactCompiler }),
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
        // Part of the migration away from airbnb config. Turned of initially.
        {
          rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
          },
        },
      ]),
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
  ]);
}
