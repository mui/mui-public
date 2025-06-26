import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import { test, describe, it } from 'vitest';
import rule from './rules-of-use-theme-variants.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

eslint.RuleTester.describe = describe;
eslint.RuleTester.it = it;
eslint.RuleTester.itOnly = it.only;

test('rules-of-use-theme-variants', () => {
  ruleTester.run('rules-of-use-theme-variants', rule, {
    valid: [
      // allowed but dangerous
      {
        name: 'custom useThemeVariants hook',
        code: `
{
  const useCustomThemeVariants = props => useThemeVariants(props);
}`,
      },
      {
        name: 'basic useThemeVariants call',
        code: `
{
  useThemeVariants(props);
}
`,
      },
      {
        name: 'useThemeVariants with destructured props',
        code: `
{
  const { className, value: valueProp, ...other } = props;
  useThemeVariants(props);
}
`,
      },
      {
        name: 'useThemeVariants with disabled prop override',
        code: `
{
  const { className, disabled = false, value: valueProp, ...other } = props;
  useThemeVariants({ ...props, disabled });
}
`,
      },
      {
        name: 'useThemeVariants with state variables',
        code: `
{
  const { className, value: valueProp, ...other } = props;
  const [stateA, setStateA] = React.useState(0);
  const [stateB, setStateB] = React.useState(0);
  useThemeVariants({ stateA, ...props, stateB });
}
`,
      },
      // unnecessary spread but it's not the responsibility of this rule to catch "unnecessary" spread
      {
        name: 'useThemeVariants with unnecessary spread',
        code: `
{
  const { className, value: valueProp, ...other } = props;
  useThemeVariants({ ...props});
}
  `,
      },
    ],
    invalid: [
      {
        name: 'disabled prop not passed to useThemeVariants',
        code: `
{
  const { disabled = false, ...other } = props;
  useThemeVariants({ ...props});
}
  `,
        errors: [
          {
            message: 'Prop `disabled` is not passed to `useThemeVariants` props.',
            line: 4,
            column: 20,
            endLine: 4,
            endColumn: 31,
          },
        ],
      },
      {
        name: 'variant prop not passed to useThemeVariants',
        code: `
{
  const { disabled = false, variant = 'text', ...other } = props;
  useThemeVariants({ ...props, disabled });
}
  `,
        errors: [
          {
            message: 'Prop `variant` is not passed to `useThemeVariants` props.',
            line: 4,
            column: 20,
            endLine: 4,
            endColumn: 42,
          },
        ],
      },
      {
        name: 'props spread must come first',
        code: `
{
  const { disabled = false, ...other } = props;
  useThemeVariants({ disabled, ...props });
}
  `,
        errors: [
          {
            message:
              'The props spread must come first in the `useThemeVariants` props. Otherwise destructured props with default values could be overridden.',
            line: 4,
            column: 32,
            endLine: 4,
            endColumn: 40,
          },
        ],
      },
      // this is valid code but not analyzable by this rule
      {
        name: 'cannot analyze identifier pattern',
        code: `
{
  const { disabled = false, ...other } = props;
  const themeVariantProps = { ...props, disabled };
  useThemeVariants(themeVariantProps);
}
  `,
        errors: [
          {
            message:
              "Can only analyze object patterns but found 'Identifier'. Prefer `{...props}`.",
            line: 5,
            column: 20,
            endLine: 5,
            endColumn: 37,
          },
        ],
      },
    ],
  });
});
