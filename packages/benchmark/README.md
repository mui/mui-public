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

### Custom metrics

Record your own measurements — a timing, a count, anything measured inside or outside React — from a plain `it()` loop. There are two primitives:

- `ScalarMetric` — a continuous value (timings, sizes). Aggregated as mean ± standard deviation with IQR outlier removal, and compared against a baseline with a relative noise band. It also offers a `console.time`-style timing helper.
- `DiscreteMetric` — a count of events. Compared as an exact integer (any change is significant) and formatted as a whole number.

```tsx
import { it } from 'vitest';
import { ScalarMetric, DiscreteMetric } from '@mui/internal-benchmark';

const duration = new ScalarMetric({
  name: 'work_duration',
  format: { style: 'unit', unit: 'millisecond' }, // Intl.NumberFormatOptions
  alarm: { direction: 'lowerIsBetter', warn: 0.1, error: 0.25 }, // warn >10%, error >25%
});

const clicks = new DiscreteMetric({ name: 'button_clicks' });

it('measures work', () => {
  for (let i = 0; i < 100; i += 1) {
    duration.time();
    runWork();
    duration.timeEnd(); // records the elapsed milliseconds

    clicks.record(countClicks()); // a discrete count per run
  }
});
```

A metric is declared once (typically at module scope) and reused across tests and iterations. `record()` attaches the value to whichever test is running, so the same instance works in any `it()`.

#### Metric configuration

- `name` — the metric's report key (**required**).
- `format` — an [`Intl.NumberFormatOptions`](https://developer.mozilla.org/en-US/docs/Web/API/Intl/NumberFormat/NumberFormat) object used to display the value.
- `alarm` — opts the metric into regression flagging. Omit it and the metric is informational (its diff is shown but never flagged). Holds:
  - `direction` — `'lowerIsBetter'` (default) or `'higherIsBetter'`.
  - `warn` — softer band; a regression past it is flagged as a warning.
  - `error` — harder band; a regression past it is flagged as an error. Defaults to the dashboard's global noise band when omitted.
  - Bands are relative fractions for scalar metrics (`0.1` = 10%) and absolute count deltas for discrete metrics (`1`, `2`). Either band is optional.

#### Sub-series

Pass `record(value, { id })` to split one metric into labeled sub-series, reported as `name#id`. For `ScalarMetric.time()`/`timeEnd()`, pass a label that maps to the same `id`:

```tsx
const phase = new ScalarMetric({ name: 'render_phase' });

phase.time('header');
renderHeader();
phase.timeEnd('header'); // -> render_phase#header
```

Custom metrics are aggregated in the browser and only the resulting stats cross to the runner, so the amount of data is independent of how many values you record.

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
- `ScalarMetric` — record a continuous custom measurement (with a `console.time`-style timing helper)
- `DiscreteMetric` — record a discrete custom count
- `createBenchmarkVitestConfig` — create a Vitest config with browser benchmarking defaults
- `BenchmarkReporter` — Vitest reporter that collects and outputs benchmark results
