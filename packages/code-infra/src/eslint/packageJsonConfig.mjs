import { defineConfig } from 'eslint/config';
import packageJson from 'eslint-plugin-package-json';

/**
 * Lints package.json files for publishing metadata. Published packages must
 * declare an SPDX license, `"author": "MUI Team"` and a repository pointing at
 * their own directory. Private packages must not carry publishing metadata.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createPackageJsonConfig() {
  return defineConfig([
    {
      name: 'package.json files',
      files: ['**/package.json'],
      ignores: ['**/__fixtures__/**'],
      extends: [packageJson.configs.recommended],
      rules: {
        'package-json/require-author': ['error', { ignorePrivate: true }],
        'package-json/require-description': ['error', { ignorePrivate: true }],
        'package-json/restrict-private-properties': [
          'error',
          { blockedProperties: ['files', 'publishConfig', 'license'] },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'Program > JSONExpressionStatement > JSONObjectExpression > JSONProperty[key.value="author"][value.value!="MUI Team"]',
            message: 'The "author" field must be "MUI Team".',
          },
        ],
        // Condition order in "exports" is significant, and scripts are grouped by purpose.
        'package-json/sort-collections': 'off',
        // Packages built with `code-infra build` get these fields in the generated package.json.
        'package-json/require-files': 'off',
        'package-json/require-sideEffects': 'off',
        'package-json/require-type': 'off',
        // Peer dependencies are installed once at the workspace root.
        'package-json/specify-peers-locally': 'off',
        // npm only auto-includes "main" when it has no "./" prefix; removing it from "files" can drop the entry point.
        'package-json/no-redundant-files': 'off',
      },
    },
  ]);
}
