import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Files keep their per-file `@vitest-environment jsdom` pragmas, so `environment` is left
    // at the default here on purpose (most tests in this package run in Node).
    setupFiles: ['./vitest.setup.ts'],
  },
});
