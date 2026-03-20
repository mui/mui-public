# Benchmark

A React component render benchmarking tool built on Vitest and Playwright. Runs benchmarks in a real browser using React's profiling build to capture accurate render durations.

## Features

- Measures React component render durations using `React.Profiler`
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

- `outputPath` — path for JSON results (default: `benchmarks/results.json`)
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

## API

- `benchmark` — define a benchmark test case
- `createBenchmarkVitestConfig` — create a Vitest config with browser benchmarking defaults
- `BenchmarkReporter` — Vitest reporter that collects and outputs benchmark results
