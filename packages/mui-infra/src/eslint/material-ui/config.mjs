const restrictedMethods = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'];

const restrictedSyntaxRules = restrictedMethods.map((method) => ({
  message: `Use global ${method} instead of window.${method}.`,
  selector: `MemberExpression[object.name='window'][property.name='${method}']`,
}));

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends[]}
 */
export default [
  {
    name: 'material-ui-base',
    rules: {
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'consistent-this': ['error', 'self'],
      curly: ['error', 'all'],
      'dot-notation': 'error',
      // Just as bad as "max components per file"
      'max-classes-per-file': 'off',
      // Too interruptive
      'no-alert': 'error',
      // Stylistic opinion
      'arrow-body-style': 'off',
      // Allow warn and error for dev environments
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-param-reassign': 'off', // It's fine.
      // Airbnb use warn https://github.com/airbnb/javascript/blob/63098cbb6c05376dbefc9a91351f5727540c1ce1/packages/eslint-config-airbnb-base/rules/style.js#L97
      // but eslint recommands error
      'func-names': 'error',

      'no-continue': 'off',
      'no-constant-condition': 'error',
      'no-implied-eval': 'error',
      'no-throw-literal': 'error',
      // Use the proptype inheritance chain
      'no-prototype-builtins': 'off',
      'no-return-await': 'error',
      'no-underscore-dangle': 'error',
      'nonblock-statement-body-position': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      // Destructuring harm grep potential.
      'prefer-destructuring': 'off',

      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false,
          classes: true,
          variables: true,
        },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // Not sure why it doesn't work
      'import/named': 'off',
      'import/no-cycle': 'off',
      // Missing yarn workspace support
      'import/no-extraneous-dependencies': 'off',
      // The code is already coupled to webpack. Prefer explicit coupling.
      'import/no-webpack-loader-syntax': 'off',
      'import/no-relative-packages': 'error',

      // doesn't work?
      'jsx-a11y/label-has-associated-control': [
        'error',
        {
          // airbnb uses 'both' which requires nesting i.e. <label><input /></label>
          // 'either' allows `htmlFor`
          assert: 'either',
        },
      ],
      // We are a library, we need to support it too
      'jsx-a11y/no-autofocus': 'off',

      'material-ui/docgen-ignore-before-comment': 'error',
      'material-ui/rules-of-use-theme-variants': 'error',
      'material-ui/no-empty-box': 'error',
      'material-ui/no-styled-box': 'error',
      'material-ui/straight-quotes': 'error',

      'react-hooks/exhaustive-deps': ['error', { additionalHooks: 'useEnhancedEffect' }],
      'react-hooks/rules-of-hooks': 'error',

      'react/default-props-match-prop-types': [
        'error',
        {
          // Otherwise the rule thinks inner props = outer props
          // But in TypeScript we want to know that a certain prop is defined during render
          // while it can be ommitted from the callsite.
          // Then defaultProps (or default values) will make sure that the prop is defined during render
          allowRequiredDefaults: true,
        },
      ],
      // Can add verbosity to small functions making them harder to grok.
      // Though we have to manually enforce it for function components with default values.
      'react/destructuring-assignment': 'off',
      'react/forbid-prop-types': 'off', // Too strict, no time for that
      'react/jsx-curly-brace-presence': 'off', // broken
      // airbnb is using .jsx
      'react/jsx-filename-extension': ['error', { extensions: ['.js', '.tsx'] }],
      // Prefer <React.Fragment> over <>.
      'react/jsx-fragments': ['error', 'element'],
      // Enforces premature optimization
      'react/jsx-no-bind': 'off',
      // We are a UI library.
      'react/jsx-props-no-spreading': 'off',
      // This rule is great for raising people awareness of what a key is and how it works.
      'react/no-array-index-key': 'off',
      'react/no-danger': 'error',
      'react/no-unknown-property': ['error', { ignore: ['sx'] }],
      'react/no-direct-mutation-state': 'error',
      // Not always relevant
      'react/require-default-props': 'off',
      'react/sort-prop-types': 'error',
      // This depends entirely on what you're doing. There's no universal pattern
      'react/state-in-constructor': 'off',
      // stylistic opinion. For conditional assignment we want it outside, otherwise as static
      'react/static-property-placement': 'off',
      // noopener is enough
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-target-blank.md#rule-options
      'react/jsx-no-target-blank': ['error', { allowReferrer: true }],

      'no-restricted-syntax': [
        'error',
        {
          message:
            "Do not import default or named exports from React. Use a namespace import (import * as React from 'react';) instead.",
          selector:
            'ImportDeclaration[source.value="react"] ImportDefaultSpecifier, ImportDeclaration[source.value="react"] ImportSpecifier',
        },
        {
          message:
            "Do not import default or named exports from ReactDOM. Use a namespace import (import * as ReactDOM from 'react-dom';) instead.",
          selector:
            'ImportDeclaration[source.value="react-dom"] ImportDefaultSpecifier, ImportDeclaration[source.value="react-dom"] ImportSpecifier',
        },
        {
          message:
            "Do not import default or named exports from ReactDOM. Use a namespace import (import * as ReactDOM from 'react-dom/client';) instead.",
          selector:
            'ImportDeclaration[source.value="react-dom/client"] ImportDefaultSpecifier, ImportDeclaration[source.value="react-dom/client"] ImportSpecifier',
        },
        {
          message:
            "Do not import default or named exports from ReactDOMServer. Use a namespace import (import * as ReactDOM from 'react-dom/server';) instead.",
          selector:
            'ImportDeclaration[source.value="react-dom/server"] ImportDefaultSpecifier, ImportDeclaration[source.value="react-dom/server"] ImportSpecifier',
        },
        {
          message:
            "The 'use client' pragma can't be used with export * in the same module. This is not supported by Next.js.",
          selector: 'ExpressionStatement[expression.value="use client"] ~ ExportAllDeclaration',
        },
        {
          message: 'Do not call `Error(...)` without `new`. Use `new Error(...)` instead.',
          selector: "CallExpression[callee.name='Error']",
        },
        ...restrictedSyntaxRules,
      ],

      // We re-export default in many places, remove when https://github.com/airbnb/javascript/issues/2500 gets resolved
      'no-restricted-exports': 'off',
      // Avoid accidental auto-"fixes" https://github.com/jsx-eslint/eslint-plugin-react/issues/3458
      'react/no-invalid-html-attribute': 'off',

      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'lines-around-directive': 'off',
      // Prevent the use of `e` as a shorthand for `event`, `error`, etc.
      'id-denylist': ['error', 'e'],
    },
  },
];
