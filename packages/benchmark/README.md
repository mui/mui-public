# Benchmark

Two ways to measure, while repositories move from the first to the second.

**Under Vitest** — a React component benchmarking tool built on Vitest and Playwright, using React's
profiling build to capture render durations against your source. Everything up to
[the `benchmark` CLI](#the-benchmark-cli) covers it. It uploads version 1 of the `benchmark` report.

**The `benchmark` CLI** — `benchmark()` and `reactBenchmark()` files, the working tree against a baseline
commit, both **built** and installed the way a consumer gets them, sampled alternately in one browser
run and compared on paired differences. It uploads version 2 of the `benchmark` report. A repository
uploads one version or the other; the dashboard reads each by its version.

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

For input that should behave like a real mouse or trackpad, the interaction context has `input`:
trusted gestures the browser generates itself at frame cadence, one command per gesture.

```tsx
benchmark(
  'Chart zoom',
  () => <Chart />,
  async ({ input }) => {
    await input.scroll({ x: 400, y: 300, deltaY: 600 });
    await input.pinch({ x: 400, y: 300, scaleFactor: 2 });
  },
);
```

A gesture's event count follows what the browser coalesced, so its render count can vary from one
iteration to the next. Wait for the mount to be painted — `await waitForElementTiming('default')` —
before starting a gesture on something the case just rendered; until then, the browser may not route
the gesture to it.

### Scoping which renders are measured

By default a benchmark records every React render and paint, from the mount through the whole interaction. To measure only part of an interaction — or to exclude the mount — pause and resume recording from the interaction callback:

```tsx
benchmark(
  'Combobox type',
  () => <Combobox />,
  async ({ pauseReactRecording, resumeReactRecording, waitForElementTiming }) => {
    pauseReactRecording(); // stop recording the settling re-renders
    await openMenu();
    resumeReactRecording(); // measure only what follows
    await type('hello');
    await waitForElementTiming('results');
  },
);
```

`pauseReactRecording()` / `resumeReactRecording()` toggle only the harness's React render and `bench:paint` recording — your own custom metrics keep recording. They are a strict pair: pausing while already paused, or resuming while already active, throws (this catches unbalanced calls early).

To exclude the mount itself, start paused with the `reactRecordingPaused` option and resume at the point you care about — the mount is captured before the interaction callback runs, so pausing inside the callback can't drop it:

```tsx
benchmark(
  'Combobox type',
  () => <Combobox />,
  async ({ resumeReactRecording }) => {
    await openMenu(); // mount + open: not recorded
    resumeReactRecording();
    await type('hello'); // only these renders/paint recorded
  },
  { reactRecordingPaused: true },
);
```

### Paint metrics

By default, every benchmark captures a `bench:paint` metric — the time from iteration start until the browser actually paints the rendered output. This uses the [Element Timing API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming) via an invisible sentinel element that the benchmark harness renders automatically. The harness owns the `bench:` namespace, so avoid it for your own metric names.

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

This produces a `bench:paint#my-component` sub-series alongside the automatic `bench:paint`.

`waitForElementTiming` accepts an optional `timeout` in milliseconds (default: 5000). Pass `0` or `Infinity` to rely on the test timeout instead.

### Custom metrics

Record your own measurements — a timing, a count, anything measured inside or outside React — from a plain `it()` loop or from inside a `benchmark()`. There are two primitives:

- `ScalarMetric` — a continuous value (timings, sizes). Aggregated as mean ± standard deviation with IQR outlier removal, and compared against a baseline with a relative noise band.
- `DiscreteMetric` — a count of events. Compared as an exact integer (any change is significant) and formatted as a whole number.

Both record values with `record(value)`. `ScalarMetric` additionally offers `time()`/`timeEnd()` — a `console.time`-style shortcut that records the elapsed milliseconds for you.

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

You can also `record()` or `time()` from inside a `benchmark()` render function or interaction callback. Values recorded during warmup iterations are excluded automatically, just like renders and `bench:paint`, so a metric recorded once per iteration yields exactly `runs` samples.

#### Metric configuration

- `name` — the metric's report key (**required**).
- `format` — an [`Intl.NumberFormatOptions`](https://developer.mozilla.org/en-US/docs/Web/API/Intl/NumberFormat/NumberFormat) object used to display the value.
- `alarm` — opts the metric into regression flagging. Omit it and the metric is informational (its diff is shown but never flagged). Holds:
  - `direction` — `'lowerIsBetter'` (default) or `'higherIsBetter'`.
  - `warn` — softer band; a regression past it is flagged as a warning.
  - `error` — harder band; a regression past it is flagged as an error. Defaults to the dashboard's global noise band only when both `warn` and `error` are omitted; with only `warn` set there is no error band (warning-only).
  - Bands are relative fractions for scalar metrics (`0.1` = 10%) and absolute count deltas for discrete metrics (`1`, `2`). Either band is optional.

Alarms are evaluated against the baseline when the PR comment is generated, not during the local `vitest run` — a regression never fails the test suite locally. In the PR comment, `error`-band regressions surface as failures and `warn`-band regressions as warnings.

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
  reactRecordingPaused: false, // start with React render/paint recording paused (default: false)
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

Filter to a single case with Vitest's `-t "<name>"` (or by file) so the window isn't shared across many cases. Profiling shares the same minimal launch args as measurement (V8 optimization and the GPU stay on for both), so the profiler reflects realistic performance; it differs only by running headed — DevTools open, in a full desktop viewport (below) — so its absolute numbers aren't directly comparable to a measurement run.

Both modes render at a 1920x1080 viewport by default (instead of Vitest's phone-sized 414x896). Set `viewport` (or the `BENCHMARK_VIEWPORT` env var) to change it; in profile mode the headed browser window is also sized to match so the full render is visible:

```bash
BENCHMARK_PROFILE=true BENCHMARK_VIEWPORT=2560x1440 vitest run -t "MyComponent mount"
```

Profile mode is also settable via the `profile` config option:

```ts
export default createBenchmarkVitestConfig({
  profile: true,
  viewport: { width: 2560, height: 1440 },
});
```

### Configuration

`createBenchmarkVitestConfig` accepts:

- `outputPath` — path for JSON results (default: `benchmarks/results.json`). Also settable via `BENCHMARK_OUTPUT_PATH`.
- `baselinePath` — path to a prior results JSON file to inline as the comparison base (see [Baseline comparisons](#baseline-comparisons)). Also settable via `BENCHMARK_BASELINE_PATH`.
- `launchArgs` — additional browser launch arguments
- `profile` — run an interactive profiling session in a headed browser with DevTools instead of measuring (see [Profiling in DevTools](#profiling-in-devtools)). Also settable via `BENCHMARK_PROFILE=true`.
- `viewport` — `{ width, height }` browser viewport (and window size in profile mode), applied to both modes. Defaults to `1920x1080`. Also settable via `BENCHMARK_VIEWPORT` (e.g. `2560x1440`).

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

## The `benchmark` CLI

The `benchmark` CLI measures a harness package's `*.bench.tsx` files across two builds of the workspace:
the working tree and a baseline. Run it from the harness, whose vite config uses the plugin:

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { benchmarkPlugin } from '@mui/internal-benchmark/vitePlugin';

export default defineConfig({ plugins: [benchmarkPlugin()] });
```

```bash
benchmark --baseline "$(code-infra baseline)"
```

### Defining cases

Benchmark files import `@mui/internal-benchmark/page`. `benchmark()` registers a case: the runner
calls its function once per sample, and the case records what it measures through a `ScalarMetric`
or `DiscreteMetric`. Nothing is measured implicitly, and a sample that records nothing fails.

```tsx
import { benchmark, ScalarMetric } from '@mui/internal-benchmark/page';

const parseTime = new ScalarMetric({ name: 'json:parse', alarm: {} });

benchmark('parse', () => {
  parseTime.time();
  JSON.parse(payload);
  parseTime.timeEnd();
});
```

`reactBenchmark()` wraps it for React: every sample mounts the element, runs the interaction, waits
for the paint and unmounts, and records `render` (total render duration), `render:count` and
`bench:paint`, plus a `render:<phase>` split when there is more than one phase. It takes the same
arguments as the Vitest `benchmark()` — so moving a file over is a rename and a new import.

```tsx
import { reactBenchmark } from '@mui/internal-benchmark/page';

reactBenchmark('mount', () => <Grid rows={1000} />);
reactBenchmark(
  'scroll',
  () => <Grid rows={1000} />,
  async ({ input }) => {
    await input.scroll({ x: 100, y: 100, deltaY: 2000 });
  },
);
```

`compare()` measures cases against each other — one library's implementation against another's —
on the working tree's build, instead of each against its baseline. The first case is the reference.

```tsx
compare('scatter', [
  reactBenchmark('ours', () => <OurScatter points={points} />),
  benchmark('other', async () => {
    const { renderScatter } = await import('other-charts');
    // …
  }),
]);
```

Every sample loads the whole benchmark file in a fresh page, so a static import reaches every case.
Import what only one case needs inside that case, before the part it times: it then loads in that
case's samples only.

### How it measures

The plugin generates a page per benchmark file under `src/__bench__/`. A benchmark file that imports
`vitest`, or the Vitest entry `@mui/internal-benchmark`, fails the build. The runner drives Chromium
through Playwright and runs each benchmark in one tab, which loads the page of the variant to be
measured — the current or the baseline build, or a case of a `compare()` — before every sample.
Every sample is the first iteration of a freshly loaded page, with garbage collected right before
it, and every variant runs in the same renderer process. Whatever a page or a process holds on to —
the JIT tier its code settled into, the heap it grew — then never favours one variant for the whole
benchmark, which the paired rounds below could not tell from a real difference.

Every variant is sampled once per round, in a shuffled order, and a difference is judged on the
per-round differences rather than on two independent sets of samples. Whatever the machine was doing
during a round — thermal throttling, a background process — then affects both sides of it and cancels
out.

Intervals are 95%, except where a change can raise an alarm — an alarmed metric of a benchmark
measured against the baseline. Every such comparison in the run shares one 5% chance of a false alarm
(Bonferroni): with 5 of them, each is a 99% interval, so a run of unchanged code raises a false alarm
at most 5% of the time rather than in about one run in five. A comparison whose per-round differences
never vary — a render count that is the same in every round — can't be flagged by chance, so it takes
no share. Sampling resolves at the same level, counting one alarmed comparison for every other
benchmark in the run; the report counts them exactly.

Run it with at least 3 logical CPUs (vCPUs in CI); it warns with fewer. On 2, V8's background
compilers are starved, so how fast the same code runs depends on how its compilation happened to go,
which costs the results precision.

### Sampling

How many rounds a benchmark is measured for adapts to its results, the way tachometer's
auto-sampling does and under tachometer's names. After `sampleSize` rounds, rounds keep being added
while any difference is unresolved against an `autoSampleConditions` horizon, for up to `timeout`
minutes. A difference is resolved against a horizon once its confidence interval lies entirely on
one side of it; `'10%'` stands for both `'-10%'` and `'+10%'`. The metrics that alarm decide, or every
metric when none does.

| Option                 | Default  | Meaning                                                                         |
| :--------------------- | :------- | :------------------------------------------------------------------------------ |
| `sampleSize`           | `50`     | Rounds measured before deciding whether to continue                             |
| `timeout`              | `3`      | Minutes to keep sampling while a difference is unresolved                       |
| `autoSampleConditions` | `['5%']` | Horizons to resolve: by default, until each change is larger or smaller than 5% |

They are set per benchmark: the last argument of `benchmark()` and `compare()`, and among
`reactBenchmark()`'s options. A compared case is sampled as its `compare()` asks, so setting its own
is an error. `--sample-size`, `--timeout` and `--auto-sample-conditions` override them for every
benchmark of a run, to iterate quickly without editing benchmark files.

```tsx
reactBenchmark('mount', () => <Grid rows={1000} />, { timeout: 1, autoSampleConditions: ['10%'] });

compare('scatter', [ours, other], { sampleSize: 100 });
```

A `'0%'` horizon asks whether there is any change at all. Two builds that perform the same never
resolve against it, so an unchanged benchmark samples until its timeout, and checking again after
every round makes a false finding likelier the longer it goes.

### The report

The run writes `.benchmark/results/report.json`, prints it as tables, and with `--upload` sends it to
the dashboard, which renders the pull request comment's Performance section and the repository's
history from it.

- The report holds **raw samples**, round-aligned across variants, plus each metric's kind, format
  and alarm, how each benchmark's sampling went, the builds, and the environment.
- `analyzeRun` from `@mui/internal-benchmark/runReport` draws every conclusion from it: a confidence
  interval on the paired difference per metric, a change (`better`, `worse`, `no change detected`, or
  `unchanged` when every round measured the same), and a severity from the metric's alarm.
- `reactBenchmark()`'s `render` alarms on any resolved change for the worse; `render:count`, the
  per-phase split and `bench:paint` are informational; every other metric brings its own alarm.
- Tables list the baseline before the current build, so a row reads old to new. The pull request
  comment keeps only the metrics that got better or worse, and sums up a benchmark where none did
  as "no change detected"; the terminal and the dashboard show every metric.

### Choosing the baseline

`--baseline` names the build the working tree is compared against: a revision — a SHA, a tag, a
branch, `HEAD~1` — on its own or behind `git:`. It is resolved to an immutable SHA before anything is
cached, and defaults to `HEAD~1`, the parent commit.

Which commit a branch should actually be compared against is `code-infra baseline`'s question: on a
feature branch the fork point, on the base branch the previous commit. On master, then, every commit
is measured against its parent, and the history the dashboard draws is each commit's own paired
change — which commit moved a number reads off the chart rather than out of a noisy trend.

### Building and installing each side

Both sides are built the same way: packed to tarballs, in parallel, and installed the way a consumer
gets them, so neither resolves the library through a workspace link. The benchmark files themselves
stay on the current branch and only the built library changes between refs — so a commit whose public
API differs from today's benchmarks will fail that ref's build, with the error surfaced.

Packed builds are cached by commit SHA under `.benchmark/packed/`, so repeating a comparison against
the same commit skips the rebuild; the working tree is never cached. In CI, cache that directory
keyed on the baseline SHA, and check out with full history so a fork point can be resolved.

A run pins the packed build in the repository's own `pnpm-workspace.yaml`, installs it there, and
resolution is then ordinary. The repository is put
back, and reinstalled, when the run ends — including when it fails, and at the start of the next run
if one was killed outright. Two things follow from it. A tracked file names tarballs under
`.benchmark/` until the run ends, so do not commit while one is in flight. And the pins are global to
the workspace for that time, because pnpm scopes an override by parent package name and a harness has
none — so nothing else should build against the same checkout meanwhile.

### Choosing what runs, and how it prints

Named as in Vitest: positional arguments keep the benchmark files whose path contains one of them,
and `-t` / `--testNamePattern` the benchmarks whose name matches a regular expression.

```bash
benchmark grid -t "scroll$" --sample-size 20 --timeout 0
```

`--reporter json` prints the run's analysis to stdout as JSON — per benchmark and metric, each
variant's median and each comparison's interval, verdict and severity, plus the regressions and how
long it all took — with everything else a run prints sent to stderr. `summarizeRun` from
`@mui/internal-benchmark/runReport` produces the same from a report. `NO_COLOR` turns colour off.

`benchmark --help` lists the remaining options.

## API

- `benchmark` — define a benchmark test case
- `@mui/internal-benchmark/vitePlugin` — `benchmarkPlugin()`, the harness's vite plugin for the `benchmark` CLI
- `@mui/internal-benchmark/runReport` — the report schema of the `benchmark` CLI, and `analyzeRun`
- `ElementTiming` — invisible marker component for paint timing (renders a `<span>` tracked by the Element Timing API)
- `ScalarMetric` — record a continuous custom measurement (with a `console.time`-style timing helper)
- `DiscreteMetric` — record a discrete custom count
- `createBenchmarkVitestConfig` — create a Vitest config with browser benchmarking defaults
- `BenchmarkReporter` — Vitest reporter that collects and outputs benchmark results
