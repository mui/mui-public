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

import globals from 'globals';
import * as tseslint from 'typescript-eslint';

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends}
 */
const baseES6Plugin = {
  languageOptions: {
    globals: {
      ...globals.es2016,
    },
    parserOptions: baseEs6.parserOptions,
  },
  rules: baseEs6.rules,
};

function convertImportToImportX(obj) {
  return Object.keys(obj).reduce((acc, key) => {
    if (key.startsWith('import-x/')) {
      acc[`import-x/${key.substring(7)}`] = obj[key];
    }
    return acc;
  }, {});
}

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends}
 */
const baseImportPlugin = {
  languageOptions: {
    globals: {
      ...globals.es2016,
    },
    parserOptions: baseImports.parserOptions,
  },
  settings: convertImportToImportX(baseImports.settings),
  rules: convertImportToImportX(baseImports.rules),
};

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends}
 */
const baseNodePlugin = {
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  rules: baseNode.rules,
};

export default tseslint.config(
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
);
