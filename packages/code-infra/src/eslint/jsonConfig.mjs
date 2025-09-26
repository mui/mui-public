import { defineConfig } from 'eslint/config';
import json from '@eslint/json';

/**
 * @returns {import('eslint').Linter.Config[]}
 */
export function createJsonConfig() {
  return defineConfig([
    // lint JSON files
    {
      files: ['**/*.json'],
      ignores: ['package-lock.json'],
      plugins: { json },
      language: 'json/json',
      extends: [json.configs.recommended],
    },

    // lint JSONC files
    {
      files: ['**/*.jsonc', '**/tsconfig.json', '**/tsconfig.*.json', '.vscode/**/*.json'],
      plugins: { json },
      language: 'json/jsonc',
      extends: [json.configs.recommended],
    },

    // lint JSON5 files
    {
      files: ['**/*.json5'],
      plugins: { json },
      language: 'json/json5',
      extends: [json.configs.recommended],
    },
  ]);
}
