import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // babel-plugin-tester expects it
    globals: true,
  },
});
