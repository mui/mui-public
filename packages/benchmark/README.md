# Benchmark

A React component render benchmarking tool built on Vitest and Playwright. Runs benchmarks in a real browser using React's profiling build to capture accurate render durations.

## Features

- Measures React component render durations using `React.Profiler`
- Captures paint metrics via the [Element Timing API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming)
- Runs in a real Chromium browser via Playwright
- Uses React's profiling build for accurate production-like measurements
- IQR-based outlier removal for stable results
- Configurable warmup and measurement runs
- JSON results output

## Usage

### Setup

Create a `vitest.config.ts`:

```ts
import { createBenchmarkVitestConfig } from '@mui/internal-benchmark/vitest';

export default createBenchmarkVitestConfig();
```

### Writing benchmarks

Create `*.bench.tsx` files:

```tsx
import * as React from 'react';
import { benchmark } from '@mui/internal-benchmark';

function MyComponent() {
  return (
    <div>
      {Array.from({ length: 100 }, (_, i) => (
        <span key={i}>{i}</span>
      ))}
    </div>
  );
}

benchmark('MyComponent mount', () => <MyComponent />);
```

The second argument is a render function (not an element) — it's called on each iteration to produce a fresh React element.

### Interactions

To benchmark re-renders, pass an interaction callback:

```tsx
benchmark(
  'Counter click',
  () => <Counter />,
  async () => {
    document.querySelector('button')?.click();
  },
);
```

### Paint metrics

By default, every benchmark captures a `paint:default` metric — the time from iteration start until the browser actually paints the rendered output. This uses the [Element Timing API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming) via an invisible sentinel element that the benchmark harness renders automatically.

You can track additional paint metrics by placing `<ElementTiming>` markers and awaiting them in an interaction callback. The component renders an invisible `<span>` that fires in the same paint frame as its surrounding content.

```tsx
import { benchmark, ElementTiming } from '@mui/internal-benchmark';

function MyComponent() {
  return (
    <div>
      <ElementTiming name="my-component" />
      {/* ... */}
    </div>
  );
}

benchmark(
  'MyComponent mount',
  () => <MyComponent />,
  async ({ waitForElementTiming }) => {
    await waitForElementTiming('my-component');
  },
);
```

This produces a `paint:my-component` metric alongside the automatic `paint:default`.

`waitForElementTiming` accepts an optional `timeout` in milliseconds (default: 5000). Pass `0` or `Infinity` to rely on the test timeout instead.

### Options

```tsx
benchmark('name', renderFn, interaction, {
  runs: 20, // measurement iterations (default: 20)
  warmupRuns: 10, // warmup iterations before measuring (default: 10)
  afterEach: () => {
    /* cleanup between iterations */
  },
});
```

### Running

```bash
vitest run
```

### Profiling in DevTools

To profile a benchmark case by hand with the browser DevTools instead of running the automated measurement loop, enable profile mode. It opens a **headed** Chromium window with DevTools already open, and replaces the measurement loop with an interactive control panel:

```bash
BENCHMARK_PROFILE=true vitest run -t "MyComponent mount"
```

Each `benchmark()` case renders a toolbar pinned to the top of the page with **Render**, **Finish**, and (when the case has an interaction) **Run interaction** buttons. The **Render** button toggles between mounting and unmounting (it reads **Unmount** while the component is mounted). The component under test stays unmounted until you click **Render**, so the flow is:

1. Switch to the DevTools **Performance** tab and start recording.
2. Click **Render** — this mounts the component (the thing you're profiling).
3. Stop the recording and inspect. Toggle **Unmount** / **Render** to capture more frames, or **Run interaction** to profile a re-render.
4. Click **Finish** to end the case and move to the next one.

Filter to a single case with Vitest's `-t "<name>"` (or by file) so the window isn't shared across many cases. Profile runs drop the deterministic V8 flags and software rendering used for measurement (`--no-opt`, `--predictable`, `--disable-gpu`, …) so the numbers in the profiler reflect realistic performance; they are therefore not comparable to measurement-mode results.

Profile mode renders into a full desktop viewport (1920x1080 by default) and sizes the browser window to match, instead of Vitest's phone-sized 414x896 default. Set it to your screen resolution to fill the whole window, via the `profileViewport` option or the `BENCHMARK_PROFILE_VIEWPORT` env var:

```bash
BENCHMARK_PROFILE=true BENCHMARK_PROFILE_VIEWPORT=2560x1440 vitest run -t "MyComponent mount"
```

Profile mode is also settable via the `profile` config option:

```ts
export default createBenchmarkVitestConfig({
  profile: true,
  profileViewport: { width: 2560, height: 1440 },
});
```

### Configuration

`createBenchmarkVitestConfig` accepts:

- `outputPath` — path for JSON results (default: `benchmarks/results.json`). Also settable via `BENCHMARK_OUTPUT_PATH`.
- `baselinePath` — path to a prior results JSON file to inline as the comparison base (see [Baseline comparisons](#baseline-comparisons)). Also settable via `BENCHMARK_BASELINE_PATH`.
- `launchArgs` — additional browser launch arguments
- `profile` — run an interactive profiling session in a headed browser with DevTools instead of measuring (see [Profiling in DevTools](#profiling-in-devtools)). Also settable via `BENCHMARK_PROFILE=true`.
- `profileViewport` — `{ width, height }` viewport (and window size) for profile mode (default: `1920x1080`). Also settable via `BENCHMARK_PROFILE_VIEWPORT` (e.g. `2560x1440`).

To override standard Vitest options (e.g. `include`, `testTimeout`, `headless`), use `mergeConfig`:

```ts
import { mergeConfig } from 'vitest/config';
import { createBenchmarkVitestConfig } from '@mui/internal-benchmark/vitest';

export default mergeConfig(createBenchmarkVitestConfig(), {
  test: {
    include: ['**/*.perf.tsx'],
  },
});
```

### Baseline comparisons

Benchmark runs are noisy across machines. To get a clean comparison in a PR, run the baseline benchmark in the _same_ CI job as the head: the results are inlined into the head upload as a `base` field, and the dashboard / PR comment render the comparison without fetching a separate base artifact from S3.

```bash
# in a PR CI job
git worktree add /tmp/base $BASE_SHA
(cd /tmp/base && pnpm install && BENCHMARK_OUTPUT_PATH=/tmp/base-bench.json pnpm test:bench)
BENCHMARK_BASELINE_PATH=/tmp/base-bench.json pnpm test:bench   # head run, inlines base
```

The feature is opt-in — without `BENCHMARK_BASELINE_PATH` (or the `baselinePath` config option), the dashboard falls back to fetching the base from S3 by merge-base SHA as before.

## API

- `benchmark` — define a benchmark test case
- `ElementTiming` — invisible marker component for paint timing (renders a `<span>` tracked by the Element Timing API)
- `createBenchmarkVitestConfig` — create a Vitest config with browser benchmarking defaults
- `BenchmarkReporter` — Vitest reporter that collects and outputs benchmark results
