/**
 * Reassembles the ESLint Airbnb typescript configuration for usage with
 * flat Eslint configuration.
 */
import baseBestPractices from 'eslint-config-airbnb-base/rules/best-practices';
import baseEs6 from 'eslint-config-airbnb-base/rules/es6';
import baseImports from 'eslint-config-airbnb-base/rules/imports';
import baseStyle from 'eslint-config-airbnb-base/rules/style';
import baseVariables from 'eslint-config-airbnb-base/rules/variables';
import * as tseslint from 'typescript-eslint';

const baseImportsRules = baseImports.rules;

if (!Array.isArray(baseImportsRules?.['import/extensions'])) {
  throw new Error(
    'Expected `import/extensions` rule to be an array in `eslint-config-airbnb-base/rules/imports`',
  );
}

export default /** @type {import('typescript-eslint').ConfigArray} */ (
  tseslint.config(
    {
      settings: {
        'import/parsers': {
          '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts'],
        },
        'import/resolver': {
          node: {
            extensions: ['.mjs', '.js', '.jsx', '.json', '.ts', '.tsx', '.d.ts'],
          },
        },
        // Append 'ts' extensions to Airbnb 'import/extensions' setting
        // Original: ['.js', '.mjs', '.jsx']
        'import/extensions': ['.js', '.mjs', '.jsx', '.ts', '.tsx', '.d.ts'],
        // Resolve type definition packages
        'import/external-module-folders': ['node_modules', 'node_modules/@types'],
      },
      rules: {
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
        'default-param-last': 'off',
        '@typescript-eslint/default-param-last': baseBestPractices.rules?.['default-param-last'],
        'no-array-constructor': 'off',
        '@typescript-eslint/no-array-constructor': baseStyle.rules?.['no-array-constructor'],
        'no-empty-function': 'off',
        '@typescript-eslint/no-empty-function': baseBestPractices.rules?.['no-empty-function'],
        'no-loss-of-precision': 'error',
        'no-loop-func': 'off',
        '@typescript-eslint/no-loop-func': baseBestPractices.rules?.['no-loop-func'],
        'no-magic-numbers': 'off',
        '@typescript-eslint/no-magic-numbers': baseBestPractices.rules?.['no-magic-numbers'],
        'no-shadow': 'off',
        '@typescript-eslint/no-shadow': baseVariables.rules?.['no-shadow'],
        'no-unused-expressions': 'off',
        '@typescript-eslint/no-unused-expressions':
          baseBestPractices.rules?.['no-unused-expressions'],
        'no-useless-constructor': 'off',
        '@typescript-eslint/no-useless-constructor': baseEs6.rules?.['no-useless-constructor'],
        'require-await': 'off',
        '@typescript-eslint/require-await': baseBestPractices.rules?.['require-await'],

        // Append 'ts' and 'tsx' to Airbnb 'import/extensions' rule
        // https://github.com/benmosher/eslint-plugin-import/blob/master/docs/rules/extensions.md
        'import/extensions': [
          baseImportsRules['import/extensions'][0],
          baseImportsRules['import/extensions'][1],
          typeof baseImportsRules['import/extensions'][2] === 'object'
            ? {
                ...baseImportsRules['import/extensions'][2],
                ts: 'never',
                tsx: 'never',
              }
            : { ts: 'never', tsx: 'never' },
        ],
      },
    },
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        // The following rules are enabled in Airbnb config, but are already checked (more thoroughly) by the TypeScript compiler
        // Some of the rules also fail in TypeScript files, for example: https://github.com/typescript-eslint/typescript-eslint/issues/662#issuecomment-507081586
        // Rules are inspired by: https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/configs/eslint-recommended.ts
        'constructor-super': 'off',
        'getter-return': 'off',
        'no-const-assign': 'off',
        'no-dupe-args': 'off',
        'no-dupe-class-members': 'off',
        'no-dupe-keys': 'off',
        'no-func-assign': 'off',
        'no-import-assign': 'off',
        'no-new-symbol': 'off',
        'no-obj-calls': 'off',
        'no-redeclare': 'off',
        'no-setter-return': 'off',
        'no-this-before-super': 'off',
        'no-undef': 'off',
        'no-unreachable': 'off',
        'no-unsafe-negation': 'off',
        'valid-typeof': 'off',
        // The following rules are enabled in Airbnb config, but are recommended to be disabled within TypeScript projects
        // See: https://github.com/typescript-eslint/typescript-eslint/blob/13583e65f5973da2a7ae8384493c5e00014db51b/docs/linting/TROUBLESHOOTING.md#eslint-plugin-import
        'import/named': 'off',
        'import/no-named-as-default-member': 'off',
        'import/no-unresolved': 'off',
      },
    },
  )
);
