import { includeIgnoreFile } from '@eslint/compat';
import eslintJs from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import compatPlugin from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import { configs as reactCompilerPluginConfigs } from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as path from 'node:path';
import * as tseslint from 'typescript-eslint';
import fs from 'node:fs';
import { createCoreConfig } from './material-ui/config.mjs';
import muiPlugin from './material-ui/index.mjs';
import { EXTENSION_TS } from './extensions.mjs';
import { createJsonConfig } from './jsonConfig.mjs';

/**
 * @param {string} filePath
 * @param {string | undefined} description
 */
function includeIgnoreIfExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    return includeIgnoreFile(filePath, description);
  }
  return [];
}

/**
 * @param {Object} [params]
 * @param {boolean} [params.enableReactCompiler] - Whether to enable React Compiler.
 * @param {boolean} [params.consistentTypeImports] - Whether to enforce consistent type imports.
 * @param {string} [params.baseDirectory] - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig({
  enableReactCompiler = false,
  consistentTypeImports = false,
  baseDirectory = process.cwd(),
} = {}) {
  return defineConfig([
    includeIgnoreIfExists(path.join(baseDirectory, '.gitignore'), `Ignore rules from .gitignore`),
    includeIgnoreIfExists(path.join(baseDirectory, '.lintignore'), `Ignore rules from .lintignore`),
    createJsonConfig(),
    prettier,
    {
      name: 'Base config',
      files: [`**/*${EXTENSION_TS}`],
      extends: defineConfig([
        eslintJs.configs.recommended,
        importPlugin.flatConfigs.recommended,
        importPlugin.flatConfigs.react,
        jsxA11yPlugin.flatConfigs.recommended,
        reactPlugin.configs.flat.recommended,
        reactHooks.configs.flat.recommended,
        tseslint.configs.recommended,
        importPlugin.flatConfigs.typescript,
        enableReactCompiler ? reactCompilerPluginConfigs.recommended : {},
        compatPlugin.configs['flat/recommended'],
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
          settings: {
            browserslistOpts: {
              config: path.join(baseDirectory, '.browserslistrc'),
              env: 'stable',
              ignoreUnknownVersions: true,
            },
          },
          extends: createCoreConfig({ enableReactCompiler, consistentTypeImports }),
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
        // Part of the migration away from airbnb config. Turned off initially.
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
      name: 'ESM JS files',
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
