import base from '@mui/internal-code-infra/stylelint';

// Note: To debug stylelint config resolution for a specific file, use
//         pnpm exec stylelint --print-config <path-to-file>

/** @type {import('stylelint').Config} */
export default {
  extends: base,
  overrides: [
    {
      files: ['**/*.module.css'],
      rules: {
        'selector-pseudo-class-no-unknown': [
          true,
          {
            ignorePseudoClasses: ['global'], // For CSS Modules :global(...) syntax
          },
        ],
      },
    },
  ],
};
