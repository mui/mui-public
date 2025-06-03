import prettier from 'eslint-config-prettier/flat';
import { flatConfigs as importFlatConfigs } from 'eslint-plugin-import';
import mochaPlugin from 'eslint-plugin-mocha';
import reactCompilerPlugin from 'eslint-plugin-react-compiler';
import { configs as reactHookConfigs } from 'eslint-plugin-react-hooks';
import testingLibrary from 'eslint-plugin-testing-library';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';

import airbnbBase from './airbnb/base.mjs';
import airbnbReact from './airbnb/react.mjs';
import airbnbTs from './airbnb/typescript.mjs';

import { createCoreConfig } from './material-ui/config.mjs';
import muiPlugin from './material-ui/index.mjs';

export const specBaseRules = {
  files: ['**/*.spec.*'],
  rules: {
    'no-alert': 'off',
    'no-console': 'off',
    'no-empty-pattern': 'off',
    'no-lone-blocks': 'off',
    'no-shadow': 'off',

    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-use-before-define': 'off',

    'import/prefer-default-export': 'off',

    'jsx-a11y/anchor-has-content': 'off',
    'jsx-a11y/anchor-is-valid': 'off',
    'jsx-a11y/tabindex-no-positive': 'off',

    'react/default-props-match-prop-types': 'off',
    'react/no-access-state-in-setstate': 'off',
    'react/no-unused-prop-types': 'off',
    'react/prefer-stateless-function': 'off',
    'react/prop-types': 'off',
    'react/require-default-props': 'off',
    'react/state-in-constructor': 'off',
    'react/static-property-placement': 'off',
    'react/function-component-definition': 'off',
  },
};

/**
 * @param {Object} [params]
 * @param {boolean} [params.enableReactCompiler] - Whether the config is for spec files.
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function createBaseConfig({ enableReactCompiler = false } = {}) {
  return tseslint.config(
    importFlatConfigs.recommended,
    importFlatConfigs.typescript,
    reactHookConfigs.recommended,
    enableReactCompiler ? reactCompilerPlugin.configs.recommended : {},
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
      extends: createCoreConfig({ reactCompilerEnabled: enableReactCompiler }),
    },
  );
}

/**
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function createTestConfig() {
  return tseslint.config(
    mochaPlugin.configs.recommended,
    testingLibrary.configs['flat/dom'],
    testingLibrary.configs['flat/react'],
    {
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          ecmaVersion: 7,
        },
        globals: globals.mocha,
      },
      settings: {
        'import/resolver': {
          typescript: {
            project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          },
        },
      },
      rules: {
        // does not work with wildcard imports. Mistakes will throw at runtime anyway
        'import/named': 'off',
        'material-ui/disallow-active-element-as-key-event-target': 'error',
        'mocha/consistent-spacing-between-blocks': 'off',

        // upgraded level from recommended
        'mocha/no-pending-tests': 'error',

        // no rationale provided in /recommended
        'mocha/no-mocha-arrows': 'off',
        // definitely a useful rule but too many false positives
        // due to `describeConformance`
        // "If you're using dynamically generated tests, you should disable this rule.""
        'mocha/no-setup-in-describe': 'off',
        // `beforeEach` for a single case is optimized for change
        // when we add a test we don't have to refactor the existing
        // test to `beforeEach`.
        // `beforeEach`+`afterEach` also means that the `beforeEach`
        // is cleaned up in `afterEach` if the test causes a crash
        'mocha/no-hooks-for-single-case': 'off',

        // disable eslint-plugin-jsx-a11y
        // tests are not driven by assistive technology
        // add `jsx-a11y` rules once you encounter them in tests
        'jsx-a11y/click-events-have-key-events': 'off',
        'jsx-a11y/control-has-associated-label': 'off',
        'jsx-a11y/iframe-has-title': 'off',
        'jsx-a11y/label-has-associated-control': 'off',
        'jsx-a11y/mouse-events-have-key-events': 'off',
        'jsx-a11y/no-noninteractive-tabindex': 'off',
        'jsx-a11y/no-static-element-interactions': 'off',
        'jsx-a11y/tabindex-no-positive': 'off',

        // In tests this is generally intended.
        'react/button-has-type': 'off',
        // They are accessed to test custom validator implementation with PropTypes.checkPropTypes
        'react/forbid-foreign-prop-types': 'off',
        // components that are defined in test are isolated enough
        // that they don't need type-checking
        'react/prop-types': 'off',
        'react/no-unused-prop-types': 'off',
      },
    },
  );
}
