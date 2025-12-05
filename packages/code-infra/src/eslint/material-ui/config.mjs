import { defineConfig } from 'eslint/config';

const restrictedMethods = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'];

const restrictedSyntaxRules = restrictedMethods.map((method) => ({
  message: `Use global ${method} instead of window.${method}.`,
  selector: `MemberExpression[object.name='window'][property.name='${method}']`,
}));

/**
 * Critical Airbnb rules missing from individual plugin recommended configs
 * @type {import('eslint').Linter.Config['rules']}
 */
const criticalAirbnbRules = {
  // Security & Best Practices
  'no-eval': 'error',
  'no-script-url': 'error',
  'array-callback-return': ['error', { allowImplicit: true }],
  'consistent-return': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  // 'no-param-reassign': ['error', { props: true }],
  'guard-for-in': 'error',
  radix: 'error',
  // disallow usage of __proto__ property
  // https://eslint.org/docs/rules/no-proto
  'no-proto': 'error',
  'vars-on-top': 'error',
  // disallow use of labels for anything other than loops and switches
  // https://eslint.org/docs/rules/no-labels
  'no-labels': ['error', { allowLoop: false, allowSwitch: false }],
  // disallow unnecessary nested blocks
  // https://eslint.org/docs/rules/no-lone-blocks
  'no-lone-blocks': 'error',
  // disallow use of new operator when not part of the assignment or comparison
  // https://eslint.org/docs/rules/no-new
  'no-new': 'error',
  // disallow use of new operator for Function object
  // https://eslint.org/docs/rules/no-new-func
  'no-new-func': 'error',

  // disallow comparisons where both sides are exactly the same
  // https://eslint.org/docs/rules/no-self-compare
  'no-self-compare': 'error',
  'no-restricted-globals': ['error', 'isFinite', 'isNaN'],

  // Styles
  // require a capital letter for constructors
  'new-cap': [
    'error',
    {
      newIsCap: true,
      newIsCapExceptions: [],
      capIsNew: false,
      capIsNewExceptions: ['Immutable.Map', 'Immutable.Set', 'Immutable.List'],
    },
  ],
  // disallow use of unary operators, ++ and --
  // https://eslint.org/docs/rules/no-plusplus
  'no-plusplus': 'error',
  // disallow use of bitwise operators
  // https://eslint.org/docs/rules/no-bitwise
  'no-bitwise': 'error',
  // disallow if as the only statement in an else block
  // https://eslint.org/docs/rules/no-lonely-if
  'no-lonely-if': 'error',

  // ES6+ Modern JavaScript
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: true }],
  'prefer-template': 'error',
  'object-shorthand': ['error', 'always'],

  // Error
  // Disallow template literal placeholder syntax in regular strings
  // https://eslint.org/docs/rules/no-template-curly-in-string
  'no-template-curly-in-string': 'error',
  // Disallow returning values from Promise executor functions
  // https://eslint.org/docs/rules/no-promise-executor-return
  'no-promise-executor-return': 'error',

  // Import rules (critical ones not in recommended)
  'import/order': ['error', { groups: [['builtin', 'external', 'internal']] }],
  'import/first': 'error',
  'import/no-mutable-exports': 'error',
  'import/newline-after-import': 'error',
  // https://github.com/import-js/eslint-plugin-import/blob/master/docs/rules/namespace.md
  'import/namespace': 'off',
  // Forbid require() calls with expressions
  // https://github.com/import-js/eslint-plugin-import/blob/master/docs/rules/no-dynamic-require.md
  'import/no-dynamic-require': 'error',

  // Additional best practices
  'default-case': ['error', { commentPattern: '^no default$' }],
  'default-case-last': 'error',
  'no-else-return': ['error', { allowElseIf: false }],
  'no-multi-assign': 'error',
  'no-nested-ternary': 'error',
  'no-unneeded-ternary': ['error', { defaultAssignment: false }],
  'spaced-comment': [
    'error',
    'always',
    {
      line: { markers: ['/'], exceptions: ['-', '+'] },
      block: { markers: ['*'], exceptions: ['*'], balanced: true },
    },
  ],
  // require all requires be top-level
  // https://eslint.org/docs/rules/global-require
  'global-require': 'error',
  // disallow use of assignment in return statement
  // https://eslint.org/docs/rules/no-return-assign
  'no-return-assign': ['error', 'always'],
  // disallow useless string concatenation
  // https://eslint.org/docs/rules/no-useless-concat
  'no-useless-concat': 'error',

  // Disallow await inside of loops
  // https://eslint.org/docs/rules/no-await-in-loop
  'no-await-in-loop': 'error',
  // disallow assignment in conditional expressions
  'no-cond-assign': ['error', 'always'],

  // React
  // Prevent usage of button elements without an explicit type attribute
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/843d71a432baf0f01f598d7cf1eea75ad6896e4b/docs/rules/button-has-type.md
  'react/button-has-type': [
    'error',
    {
      button: true,
      submit: true,
      reset: false,
    },
  ],
  // Prevent missing displayName in a React component definition
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/display-name.md
  'react/display-name': ['off', { ignoreTranspilerName: false }],
  // Enforce a specific function type for function components
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/function-component-definition.md
  'react/function-component-definition': [
    'error',
    {
      namedComponents: ['function-declaration', 'function-expression'],
      unnamedComponents: 'function-expression',
    },
  ],
  // Prevent react contexts from taking non-stable values
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/e2eaadae316f9506d163812a09424eb42698470a/docs/rules/jsx-no-constructed-context-values.md
  'react/jsx-no-constructed-context-values': 'error',
  // Require stateless functions when not using lifecycle methods, setState or ref
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/prefer-stateless-function.md
  'react/prefer-stateless-function': ['error', { ignorePureComponents: true }],
  // Forbids using non-exported propTypes
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/forbid-foreign-prop-types.md
  // this is intentionally set to "warn". it would be "error",
  // but it's only critical if you're stripping propTypes in production.
  'react/forbid-foreign-prop-types': ['warn', { allowInPropTypes: true }],
  // Validate JSX has key prop when in array or iterator
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-key.md
  // Turned off because it has too many false positives
  'react/jsx-key': 'off',
  // Prevent unused propType definitions
  // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/no-unused-prop-types.md
  'react/no-unused-prop-types': [
    'error',
    {
      customValidators: [],
      skipShapeProps: true,
    },
  ],
};

/**
 * TypeScript-specific rules (replaces Airbnb TypeScript config)
 * @type {import('eslint').Linter.Config['rules']}
 */
const typescriptOverrides = {
  // The following rules are enabled in Airbnb config, but are recommended to be disabled within TypeScript projects
  // See: https://github.com/typescript-eslint/typescript-eslint/blob/13583e65f5973da2a7ae8384493c5e00014db51b/docs/linting/TROUBLESHOOTING.md#eslint-plugin-import
  'import/named': 'off',
  'import/no-named-as-default-member': 'off',
  'import/no-unresolved': 'off',

  // TypeScript equivalents of ESLint rules
  'default-param-last': 'off',
  '@typescript-eslint/default-param-last': 'error',
  'no-array-constructor': 'off',
  '@typescript-eslint/no-array-constructor': 'error',
  '@typescript-eslint/triple-slash-reference': 'off',
  'no-empty-function': 'off',
  // disallow empty functions, except for standalone funcs/arrows
  // https://eslint.org/docs/rules/no-empty-function
  '@typescript-eslint/no-empty-function': [
    'error',
    {
      allow: ['arrowFunctions', 'functions', 'methods'],
    },
  ],
  'no-loss-of-precision': 'error',
  'no-loop-func': 'off',
  '@typescript-eslint/no-loop-func': 'error',
  'no-shadow': 'off',
  '@typescript-eslint/no-shadow': 'error',
  'no-unused-expressions': 'off',
  '@typescript-eslint/no-unused-expressions': [
    'error',
    { allowShortCircuit: false, allowTernary: false },
  ],
  'no-useless-constructor': 'off',
  '@typescript-eslint/no-useless-constructor': 'error',
  'require-await': 'off',

  // TypeScript naming convention (replaces camelcase)
  camelcase: 'off',

  // The `@typescript-eslint/naming-convention` rule allows `leadingUnderscore` and `trailingUnderscore` settings. However, the existing `no-underscore-dangle` rule already takes care of this.
  '@typescript-eslint/naming-convention': [
    'error',
    // Allow camelCase variables (23.2), PascalCase variables (23.8), and UPPER_CASE variables (23.10)
    {
      selector: 'variable',
      format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
    },
    // Allow camelCase functions (23.2), and PascalCase functions (23.8)
    {
      selector: 'function',
      format: ['camelCase', 'PascalCase'],
    },
    // Airbnb recommends PascalCase for classes (23.3), and although Airbnb does not make TypeScript recommendations, we are assuming this rule would similarly apply to anything "type like", including interfaces, type aliases, and enums
    {
      selector: 'typeLike',
      format: ['PascalCase'],
    },
  ],

  // Namespace rule
  '@typescript-eslint/no-namespace': 'off',
  '@typescript-eslint/no-this-alias': 'off',

  // TypeScript extensions handling
  'import/extensions': [
    'error',
    'ignorePackages',
    {
      js: 'never',
      mjs: 'never',
      jsx: 'never',
      ts: 'never',
      tsx: 'never',
    },
  ],
};

/**
 * @type {import('eslint').Linter.Config['rules']}
 */
const airbnbJsxA11y = {
  // Enforce that all elements that require alternative text have meaningful information
  // https://github.com/evcohen/eslint-plugin-jsx-a11y/blob/master/docs/rules/alt-text.md
  'jsx-a11y/alt-text': [
    'error',
    {
      elements: ['img'],
    },
  ],

  // ensure <a> tags are valid
  // https://github.com/evcohen/eslint-plugin-jsx-a11y/blob/0745af376cdc8686d85a361ce36952b1fb1ccf6e/docs/rules/anchor-is-valid.md
  'jsx-a11y/anchor-is-valid': [
    'error',
    {
      components: ['Link'],
      specialLink: ['to'],
      aspects: ['noHref', 'invalidHref', 'preferButton'],
    },
  ],

  // Enforce that a control (an interactive element) has a text label.
  // https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/master/docs/rules/control-has-associated-label.md
  'jsx-a11y/control-has-associated-label': [
    'error',
    {
      labelAttributes: ['label'],
      controlComponents: [],
      ignoreElements: ['audio', 'canvas', 'embed', 'input', 'textarea', 'tr', 'video'],
      ignoreRoles: [
        'grid',
        'listbox',
        'menu',
        'menubar',
        'radiogroup',
        'row',
        'tablist',
        'toolbar',
        'tree',
        'treegrid',
      ],
      depth: 5,
    },
  ],
};

/**
 * @param {Object} [options]
 * @param {boolean} [options.enableReactCompiler] - Whether the config is for spec files.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createCoreConfig(options = {}) {
  return defineConfig([
    {
      name: 'material-ui-base',
      settings: {
        'import/resolver': {
          node: {
            extensions: ['.mjs', '.js', '.json'],
          },
          typescript: {
            project: ['tsconfig.node.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          },
        },
        'import/extensions': ['.js', '.mjs', '.jsx', '.ts', '.tsx', '.d.ts'],
        'import/core-modules': [],
        'import/ignore': ['node_modules', '\\.(css|svg|json)$'],
        // Override with TypeScript-specific settings
        'import/parsers': {
          '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        // Extend Airbnb extensions with TypeScript
        'import/external-module-folders': ['node_modules', 'node_modules/@types'],
      },
      rules: {
        ...criticalAirbnbRules,
        ...airbnbJsxA11y,
        ...typescriptOverrides,
        'no-redeclare': 'off',
        '@typescript-eslint/no-redeclare': 'off',
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
        'no-underscore-dangle': 'error',
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

        // Not needed in general, can be turned on for specific files
        'import/prefer-default-export': 'off',
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
        'material-ui/straight-quotes': 'off',

        'react-hooks/exhaustive-deps': [
          'error',
          { additionalHooks: '(useEnhancedEffect|useIsoLayoutEffect)' },
        ],
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
        'react/jsx-filename-extension': ['error', { extensions: ['.jsx', '.tsx'] }],
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
        ...(options.enableReactCompiler ? { 'react-compiler/react-compiler': 'error' } : {}),
        // Prevent the use of `e` as a shorthand for `event`, `error`, etc.
        'id-denylist': ['error', 'e'],
        '@typescript-eslint/return-await': 'off',
      },
    },
  ]);
}
