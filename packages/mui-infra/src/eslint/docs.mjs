import nextjs from '@next/eslint-plugin-next';
import * as tselint from 'typescript-eslint';

/**
 * @type {import('typescript-eslint').ConfigArray}
 */
export default tselint.config(nextjs.flatConfig.recommended, {
  settings: {
    next: {
      rootDir: 'docs',
    },
  },
  rules: {
    // We're not using the Image component at the moment
    '@next/next/no-img-element': 'off',
    'no-irregular-whitespace': ['error', { skipJSXText: true, skipStrings: true }],
  },
});
