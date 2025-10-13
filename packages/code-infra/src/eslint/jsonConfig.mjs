import { defineConfig } from 'eslint/config';
import json from '@eslint/json';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createJsonConfig() {
  return defineConfig([
    {
      name: 'JSON files',
      files: ['**/*.json'],
      ignores: ['package-lock.json'],
      plugins: { json },
      language: 'json/json',
      extends: [json.configs.recommended],
    },

    {
      name: 'JSONC files',
      files: [
        '**/*.jsonc',
        '**/tsconfig.json',
        '**/tsconfig.*.json',
        '.vscode/**/*.json',
        'renovate.json',
      ],
      plugins: { json },
      language: 'json/jsonc',
      extends: [json.configs.recommended],
    },

    {
      name: 'JSON5 files',
      files: ['**/*.json5'],
      plugins: { json },
      language: 'json/json5',
      extends: [json.configs.recommended],
    },
  ]);
}
