import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { ViteUserConfig } from 'vitest/config';

export interface CreateBenchmarkVitestConfigOptions {
  /**
   * Path to save benchmark results JSON file. If not provided, results will not be saved to disk.
   */
  outputPath?: string;
  /**
   * Path to a prior benchmark results JSON file. When set, its contents are
   * inlined as the `base` field of the head upload so the dashboard and PR
   * comment can render a comparison without fetching a separate base
   * artifact from S3. Also settable via the `BENCHMARK_BASELINE_PATH` env var.
   */
  baselinePath?: string;
  /**
   * Additional Chromium launch arguments.
   */
  launchArgs?: string[];
}

export function createBenchmarkVitestConfig(
  options?: CreateBenchmarkVitestConfigOptions,
): ViteUserConfig {
  const { outputPath, baselinePath, launchArgs = [] } = options ?? {};

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
              // Reduces environmental noise by disabling field trials,
              // for more consistent profiling results.
              '--enable-benchmarking',
              // Forces software rendering instead of GPU, which is more deterministic.
              '--disable-gpu',

              ...launchArgs,
            ],
          },
        }),
      },
      fileParallelism: false,
      reporters: ['default', ['@mui/internal-benchmark/reporter', { outputPath, baselinePath }]],
      include: ['**/*.bench.tsx'],
    },
  };
}
