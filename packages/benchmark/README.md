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

### Configuration

`createBenchmarkVitestConfig` accepts:

- `outputPath` — path for JSON results (default: `benchmarks/results.json`). Also settable via `BENCHMARK_OUTPUT_PATH`.
- `baselinePath` — path to a prior results JSON file to inline as the comparison base (see [Baseline comparisons](#baseline-comparisons)). Also settable via `BENCHMARK_BASELINE_PATH`.
- `launchArgs` — additional browser launch arguments

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
