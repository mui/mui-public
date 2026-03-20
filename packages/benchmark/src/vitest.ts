import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { ViteUserConfig } from 'vitest/config';

export interface CreateBenchmarkVitestConfigOptions {
  outputPath?: string;
  launchArgs?: string[];
}

export function createBenchmarkVitestConfig(
  options?: CreateBenchmarkVitestConfigOptions,
): ViteUserConfig {
  const { outputPath, launchArgs = [] } = options ?? {};

  return {
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }],
    },
    test: {
      browser: {
        enabled: true,
        headless: true,
        screenshotFailures: false,
        instances: [{ browser: 'chromium', testTimeout: 120_000 }],
        provider: playwright({
          launchOptions: {
            args: [
              // V8 flags for deterministic JS execution
              '--js-flags=--expose-gc,--predictable,--no-opt,--predictable-gc-schedule,--no-concurrent-sweeping,--hash-seed=1,--random-seed=1,--max-old-space-size=4096',

              // Chromium flags to reduce renderer/compositor noise
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-background-networking',
              '--enable-benchmarking',
              '--disable-gpu',

              ...launchArgs,
            ],
          },
        }),
      },
      fileParallelism: false,
      reporters: ['default', ['@mui/internal-benchmark/reporter', { outputPath }]],
      include: ['**/*.bench.tsx'],
    },
  };
}
