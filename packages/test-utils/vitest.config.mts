import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@mui/internal-test-utils',
    environment: 'jsdom',
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, 'test/setupVitest/**'],
        },
      },
      ...[true, false].map((isolate) => ({
        test: {
          name: `setupVitest-${isolate ? 'isolated' : 'shared'}`,
          include: ['test/setupVitest/*.test.{ts,tsx}'],
          setupFiles: ['test/setupVitest/setup.ts'],
          isolate,
          // Reuse one worker across files in the shared project to exercise setup-file registration.
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      })),
    ],
  },
});
