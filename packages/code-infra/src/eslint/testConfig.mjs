import mochaPlugin from 'eslint-plugin-mocha';
import vitestPlugin from '@vitest/eslint-plugin';
import testingLibrary from 'eslint-plugin-testing-library';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import * as tseslint from 'typescript-eslint';
import { EXTENSION_TS } from './extensions.mjs';

/**
 * @type {import('eslint').Linter.Config}
 */
export const baseSpecRules = {
  name: 'Spec files rules',
  files: [`**/*.spec${EXTENSION_TS}`],
  rules: {
    'compat/compat': 'off',
    'no-alert': 'off',
    'no-console': 'off',
    'no-empty-pattern': 'off',
    'no-lone-blocks': 'off',
    'no-shadow': 'off',

    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',

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
 * @param {Object} [options]
 * @param {boolean} [options.useMocha]
 * @param {boolean} [options.useVitest]
 * @returns {import('eslint').Linter.Config[]}
 */
export function createTestConfig(options = {}) {
  const { useMocha = true, useVitest = false } = options;
  return defineConfig(
    useMocha ? mochaPlugin.configs.recommended : {},
    useVitest ? vitestPlugin.configs.recommended : {},
    testingLibrary.configs['flat/dom'],
    testingLibrary.configs['flat/react'],
    {
      name: 'Test files',
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          ecmaVersion: 7,
        },
        globals: globals.mocha,
      },
      rules: {
        'compat/compat': 'off',
        // does not work with wildcard imports. Mistakes will throw at runtime anyway
        'import/named': 'off',
        'mui/disallow-active-element-as-key-event-target': 'error',
        'mui/consistent-production-guard': 'off',

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
        'jsx-a11y/anchor-is-valid': 'off',

        // In tests this is generally intended.
        'react/button-has-type': 'off',
        // They are accessed to test custom validator implementation with PropTypes.checkPropTypes
        'react/forbid-foreign-prop-types': 'off',
        // components that are defined in test are isolated enough
        // that they don't need type-checking
        'react/prop-types': 'off',
        'react/no-unused-prop-types': 'off',
        // Part of the migration away from airbnb config. Turned of initially.
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        'testing-library/no-node-access': 'off',
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
        // end migration
        ...(useMocha
          ? {
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
            }
          : {}),
      },
    },
  );
}
