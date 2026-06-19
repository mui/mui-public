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
   * DevTools profiler before the component mounts. Profiling auto-opens DevTools
   * and runs headed (pass `viewport` to size the window). Also settable via
   * `BENCHMARK_PROFILE=true`.
   */
  profile?: boolean;
  /**
   * Browser viewport — and, in profile mode, the matching window size. Defaults to 1920x1080 for
   * both measurement and profiling. Also settable via `BENCHMARK_VIEWPORT` (e.g. `2560x1440`).
   */
  viewport?: { width: number; height: number };
}

// Default viewport for all benchmark runs (measurement and profiling alike) — a desktop size is
// more representative for component benchmarks than Vitest's phone-sized 414x896 browser default.
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

// Explicit viewport from the `viewport` option or the `BENCHMARK_VIEWPORT` env var
// (`<width>x<height>`); undefined when neither is set, so the caller can apply the default.
function resolveViewport(option?: {
  width: number;
  height: number;
}): { width: number; height: number } | undefined {
  if (option) {
    return option;
  }
  const env = process.env.BENCHMARK_VIEWPORT;
  const match = env ? env.split('x') : null;
  if (match && match.length === 2) {
    return { width: Number(match[0]), height: Number(match[1]) };
  }
  return undefined;
}

// Chromium/V8 launch args shared by measurement and profiling, kept intentionally minimal.
// `--expose-gc` is required: the harness forces GC between iterations for clean, comparable
// timings. The backgrounding flags stop Chrome from throttling the (headless or occluded)
// benchmark tab, which would otherwise add large variance. Heavier "determinism" flags
// (`--no-opt`, `--predictable`, `--hash-seed`/`--random-seed`, `--disable-gpu`,
// `--enable-benchmarking`) were measured to slow renders ~40% and distort paint timing without
// reducing variance, so they are omitted — add them per project via `launchArgs` if a specific
// workload needs them.
const LAUNCH_ARGS = [
  '--js-flags=--expose-gc',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

export function createBenchmarkVitestConfig(
  options?: CreateBenchmarkVitestConfigOptions,
): ViteUserConfig {
  const { outputPath, baselinePath, launchArgs = [] } = options ?? {};
  const profile = options?.profile ?? process.env.BENCHMARK_PROFILE === 'true';
  const viewport = resolveViewport(options?.viewport) ?? DEFAULT_VIEWPORT;

  // Profiling adds DevTools on top of the shared args, plus a window sized to match the viewport —
  // Vitest's `viewport` only sizes the iframe, so otherwise it's cropped/scrolled in the headed
  // window instead of filling it. (Measurement is headless, so it has no window to size.)
  const profileArgs = [
    ...LAUNCH_ARGS,
    '--auto-open-devtools-for-tabs',
    `--window-size=${viewport.width},${viewport.height}`,
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
        // Same viewport for both modes (DEFAULT_VIEWPORT unless overridden).
        viewport,
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
            args: [...(profile ? profileArgs : LAUNCH_ARGS), ...launchArgs],
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
