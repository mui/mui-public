import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests run on the server, so resolve the marker to the module React Server Components get.
      'server-only': fileURLToPath(new URL('empty.js', import.meta.resolve('server-only'))),
    },
  },
  test: {
    // Files keep their per-file `@vitest-environment jsdom` pragmas, so `environment` is left
    // at the default here on purpose (most tests in this package run in Node).
    setupFiles: ['./vitest.setup.ts'],
  },
});
