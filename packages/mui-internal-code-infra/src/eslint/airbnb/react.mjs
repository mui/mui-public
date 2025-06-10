/**
 * Reassembles the ESLint Airbnb react configuration for usage with
 * flat Eslint configuration.
 */
import airbnbReact from 'eslint-config-airbnb/rules/react';
import airbnbReactA11y from 'eslint-config-airbnb/rules/react-a11y';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import * as tseslint from 'typescript-eslint';

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
    react,
  },
  rules: airbnbReact.rules,
};

/**
 * @type {import('typescript-eslint').InfiniteDepthConfigWithExtends}
 */
const airbnbReactA11yPlugin = {
  plugins: {
    'jsx-a11y': jsxA11y,
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

export default tseslint.config(
  { name: 'airbnb-react', ...airbnbReactPlugin },
  { name: 'airbnb-react-a11y', ...airbnbReactA11yPlugin },
);
