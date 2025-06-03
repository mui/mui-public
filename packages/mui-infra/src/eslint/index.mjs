import prettier from 'eslint-config-prettier/flat';
import { flatConfigs as importFlatConfigs } from 'eslint-plugin-import';
import { configs as reactHookConfigs } from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';

import airbnbBase from './airbnb/base.mjs';
import airbnbReact from './airbnb/react.mjs';
import airbnbTs from './airbnb/typescript.mjs';

import muiPlugin from './material-ui/index.mjs';
import muiConfig from './material-ui/config.mjs';

/**
 * @type {import('typescript-eslint').ConfigArray}
 */
export default tseslint.config(
  importFlatConfigs.recommended,
  importFlatConfigs.typescript,
  reactHookConfigs.recommended,
  airbnbBase,
  airbnbReact,
  airbnbTs,
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
    },
    extends: muiConfig,
  },
);
