import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      '.github/actions/renovate-pr-report',
      '.github/workflows/scripts',
    ],
  },
});
