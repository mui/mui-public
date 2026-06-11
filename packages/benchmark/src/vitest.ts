import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { type ViteUserConfig } from 'vitest/config';

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
  /**
   * Run each `benchmark()` case as an interactive profiling session in a headed
   * browser instead of the automated measurement loop. Each case renders a
   * control panel with Render / Unmount / Finish buttons so you can start the
   * DevTools profiler before the component mounts. The deterministic V8 flags
   * and software rendering used for measurement are dropped so the numbers in
   * the profiler reflect realistic performance. Also settable via
   * `BENCHMARK_PROFILE=true`.
   */
  profile?: boolean;
  /**
   * Viewport (and matching browser window size) used in profile mode. Vitest's
   * default browser viewport is a phone-sized 414x896; profiling overrides it
   * with a full desktop viewport so the component renders at a realistic size.
   * Set this to your screen's resolution to fill the whole window. Also settable
   * via `BENCHMARK_PROFILE_VIEWPORT` (e.g. `2560x1440`). Defaults to 1920x1080.
   */
  profileViewport?: { width: number; height: number };
}

// Resolves the profile-mode viewport from the option, the
// `BENCHMARK_PROFILE_VIEWPORT` env var (`<width>x<height>`), or a 1920x1080
// default.
function resolveProfileViewport(option?: { width: number; height: number }): {
  width: number;
  height: number;
} {
  if (option) {
    return option;
  }
  const env = process.env.BENCHMARK_PROFILE_VIEWPORT;
  const match = env ? /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/.exec(env) : null;
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return { width: 1920, height: 1080 };
}

// Determinism flags used for measurement runs. They make timings reproducible
// but are NOT representative of real performance (`--no-opt` disables the
// optimizing compiler, `--disable-gpu` forces software rendering), so profiling
// runs use a lighter set instead.
const MEASUREMENT_LAUNCH_ARGS = [
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
];

// Launch args for interactive profiling: keep GC exposed and reduce background
// throttling noise, but let V8 optimize and the GPU render normally, and open
// DevTools automatically so the profiler is one click away.
const PROFILE_LAUNCH_ARGS = [
  '--js-flags=--expose-gc',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--auto-open-devtools-for-tabs',
];

export function createBenchmarkVitestConfig(
  options?: CreateBenchmarkVitestConfigOptions,
): ViteUserConfig {
  const { outputPath, baselinePath, launchArgs = [] } = options ?? {};
  const profile = options?.profile ?? process.env.BENCHMARK_PROFILE === 'true';
  const profileViewport = resolveProfileViewport(options?.profileViewport);

  // Size the actual browser window to the viewport too: Vitest's `viewport` only
  // sizes the test iframe, so without this the headed window stays small and the
  // full-size iframe is cropped/scrolled instead of filling the window.
  const profileArgs = [
    ...PROFILE_LAUNCH_ARGS,
    `--window-size=${profileViewport.width},${profileViewport.height}`,
  ];

  return {
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BENCHMARK_PROFILE': JSON.stringify(profile ? 'true' : ''),
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }],
    },
    test: {
      browser: {
        enabled: true,
        headless: !profile,
        // Profiling renders into a clean page: hide Vitest's browser runner UI
        // so the orchestrator chrome doesn't clutter what you're profiling.
        ui: profile ? false : undefined,
        // Vitest's default browser viewport is a phone-sized 414x896. For
        // profiling, render into a full desktop viewport instead. (Measurement
        // keeps the default so results stay comparable.)
        viewport: profile ? profileViewport : undefined,
        screenshotFailures: false,
        instances: [
          {
            browser: 'chromium',
            // Profiling sessions are driven by hand, so give them effectively
            // unlimited time instead of the measurement timeout.
            testTimeout: profile ? 365 * 24 * 60 * 60 * 1000 : 120_000,
          },
        ],
        provider: playwright({
          launchOptions: {
            args: [...(profile ? profileArgs : MEASUREMENT_LAUNCH_ARGS), ...launchArgs],
          },
        }),
      },
      fileParallelism: false,
      // Profiling sessions don't measure anything, so skip the results reporter.
      reporters: profile
        ? ['default']
        : ['default', ['@mui/internal-benchmark/reporter', { outputPath, baselinePath }]],
      include: ['**/*.bench.tsx'],
    },
  };
}
