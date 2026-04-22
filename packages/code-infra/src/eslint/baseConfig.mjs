import { includeIgnoreFile, fixupConfigRules } from '@eslint/compat';
import eslintJs from '@eslint/js';
// TODO: change back to 'eslint/config' once https://github.com/eslint/rewrite/issues/425 is fixed
import { defineConfig } from '@eslint/config-helpers';
import prettier from 'eslint-config-prettier/flat';
import compatPlugin from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import markdownPlugin from '@eslint/markdown';
import markdownMuiPlugin from './markdown/index.mjs';
import { configs as reactCompilerPluginConfigs } from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as path from 'node:path';
import * as tseslint from 'typescript-eslint';
import fs from 'node:fs';
import { createCoreConfig } from './mui/config.mjs';
import muiPlugin from './mui/index.mjs';
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
 * @param {boolean} [params.materialUi] - Whether to enable Material UI specific rules (mui/material-ui-*).
 * @param {string} [params.baseDirectory] - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig({
  enableReactCompiler = false,
  consistentTypeImports = false,
  materialUi = false,
  baseDirectory = process.cwd(),
} = {}) {
  return defineConfig([
    includeIgnoreIfExists(path.join(baseDirectory, '.gitignore'), `Ignore rules from .gitignore`),
    includeIgnoreIfExists(path.join(baseDirectory, '.lintignore'), `Ignore rules from .lintignore`),
    createJsonConfig(),
    prettier,
    // Markdown linting for .md files
    markdownPlugin.configs.recommended,
    {
      files: ['**/*.md'],
      // GFM is what GitHub renders, and it's required for tables to be parsed.
      language: 'markdown/gfm',
      plugins: {
        'markdown-mui': markdownMuiPlugin,
      },
      rules: {
        'markdown/no-duplicate-headings': 'error',
        'markdown/no-missing-label-refs': [
          'error',
          { allowLabels: ['!NOTE', '!TIP', '!WARNING', '!IMPORTANT', '!CAUTION'] },
        ],
        'markdown-mui/blanks-around-tables': 'error',
        'markdown-mui/git-diff': 'error',
        'markdown-mui/no-closed-atx-heading': 'error',
        'markdown-mui/no-indented-code': 'error',
        'markdown-mui/no-space-in-links': 'error',
        'markdown-mui/no-trailing-punctuation-in-heading': 'error',
        'markdown-mui/straight-quotes': 'error',
        'markdown-mui/table-alignment': 'error',
        'markdown-mui/terminal-language': 'error',
      },
    },
    {
      name: 'Base config',
      files: [`**/*${EXTENSION_TS}`],
      extends: defineConfig([
        eslintJs.configs.recommended,
        // Fix ESLint 10 compatibility for plugins that use deprecated context methods
        ...fixupConfigRules([importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.react]),
        ...fixupConfigRules(jsxA11yPlugin.flatConfigs.recommended),
        ...fixupConfigRules(reactPlugin.configs.flat.recommended),
        ...fixupConfigRules(reactHooks.configs.flat.recommended),
        tseslint.configs.recommended,
        ...fixupConfigRules(importPlugin.flatConfigs.typescript),
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
            mui: muiPlugin,
          },
          settings: {
            browserslistOpts: {
              config: path.join(baseDirectory, '.browserslistrc'),
              env: 'stable',
              ignoreUnknownVersions: true,
            },
          },
          extends: createCoreConfig({ enableReactCompiler, consistentTypeImports, materialUi }),
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
        // New ESLint 10 rules - turned off initially to ease migration
        {
          name: 'ESLint 10 new rules',
          rules: {
            // Requires attaching caught errors as `cause` when re-throwing
            'preserve-caught-error': 'off',
            // Disallows assignments that are never used
            'no-useless-assignment': 'off',
            // Disallows unused vars without explicit init (use @typescript-eslint/no-unused-vars instead)
            'no-unassigned-vars': 'off',
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
