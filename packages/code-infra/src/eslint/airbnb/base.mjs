/**
 * Reassembles the ESLint Airbnb base configuration for usage with
 * flat Eslint configuration.
 */
import baseBestPractices from 'eslint-config-airbnb-base/rules/best-practices';
import baseErrors from 'eslint-config-airbnb-base/rules/errors';
import baseEs6 from 'eslint-config-airbnb-base/rules/es6';
import baseImports from 'eslint-config-airbnb-base/rules/imports';
import baseNode from 'eslint-config-airbnb-base/rules/node';
import baseStrict from 'eslint-config-airbnb-base/rules/strict';
import baseStyle from 'eslint-config-airbnb-base/rules/style';
import baseVariables from 'eslint-config-airbnb-base/rules/variables';
import airbnbReact from 'eslint-config-airbnb/rules/react';
import airbnbReactA11y from 'eslint-config-airbnb/rules/react-a11y';
import eslintPluginImportX from 'eslint-plugin-import-x';
import eslintPluginJsxA11y from 'eslint-plugin-jsx-a11y';
import eslintPluginReact from 'eslint-plugin-react';

import globals from 'globals';
import * as tseslint from 'typescript-eslint';

const baseES6Plugin = {
  languageOptions: {
    globals: {
      ...globals.es2016,
    },
    parserOptions: baseEs6.parserOptions,
  },
  rules: baseEs6.rules,
};

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function migrateToImportX(obj) {
  /**
   * @type {Record<string, unknown>}
   */
  const newObj = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('import/')) {
      newObj[key.replace('import/', 'import-x/')] = value;
    } else {
      newObj[key] = value;
    }
  }
  return newObj;
}

const baseImportPlugin = {
  languageOptions: {
    globals: {
      ...globals.es2016,
    },
    parserOptions: baseImports.parserOptions,
  },
  settings: baseImports.settings ? migrateToImportX(baseImports.settings) : undefined,
  rules: baseImports.rules
    ? /** @type {Partial<import('eslint').Linter.RulesRecord>} */ (
        migrateToImportX(baseImports.rules)
      )
    : undefined,
  plugins: {
    'import-x': eslintPluginImportX,
  },
};

const baseNodePlugin = {
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  rules: baseNode.rules,
};

export const airbnbBaseConfig = /** @type {import('eslint').Linter.Config[]} */ (
  tseslint.config(
    {
      name: 'base-best-practices',
      ...baseBestPractices,
    },
    {
      name: 'base-errors',
      ...baseErrors,
    },
    {
      name: 'base-node',
      ...baseNodePlugin,
    },
    { name: 'base-style', ...baseStyle },
    { name: 'base-variables', ...baseVariables },
    { name: 'base-es6-plugin', ...baseES6Plugin },
    { name: 'base-import-plugin', ...baseImportPlugin },
    { name: 'base-strict', ...baseStrict },
  )
);

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends}
 */
const airbnbReactPlugin = {
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
  plugins: {
    react: eslintPluginReact,
  },
  rules: airbnbReact.rules,
};

const airbnbReactA11yPlugin = {
  plugins: {
    'jsx-a11y': eslintPluginJsxA11y,
  },
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
  rules: airbnbReactA11y.rules,
};

export const airbnbReactConfig = /** @type {import('eslint').Linter.Config[]} */ (
  tseslint.config(
    { name: 'airbnb-react', ...airbnbReactPlugin },
    { name: 'airbnb-react-a11y', ...airbnbReactA11yPlugin },
  )
);
