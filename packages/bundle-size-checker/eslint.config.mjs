export default {
  rules: {
    'import-x/prefer-default-export': 'off',
    // Allow .js file extensions in import statements for ESM compatibility
    'import-x/extensions': [
      'error',
      'ignorePackages',
      {
        js: 'always',
        mjs: 'always',
      },
    ],
  },
};
