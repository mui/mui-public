# Benchmark

Two ways to measure, for two different questions.

**Render durations** — a React component benchmarking tool built on Vitest and Playwright, using
React's profiling build to capture accurate render durations against your source. Everything up to
[Tachometer](#tachometer) covers it.

**Wall-clock time** — [Tachometer](#tachometer) below: Google's
[tachometer](https://github.com/google/tachometer) driving a real browser against your **built**
package, comparing two commits of it with interleaved sampling. No profiler and no render counts,
only elapsed milliseconds on what a consumer installs.

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

### Comparing implementations

`compare()` measures implementations against each other — one library against another — instead of
one build against another. Each variant is a module of ordinary `benchmark()` calls, loaded lazily;
cases are paired across variants by name, and the first variant is the reference:

```tsx
// scatter.bench.tsx
import { compare } from '@mui/internal-benchmark';

compare('scatter', {
  ours: () => import('./scatter.ours'),
  recharts: () => import('./scatter.recharts'),
});
```

```tsx
// scatter.recharts.tsx
import { benchmark } from '@mui/internal-benchmark';

benchmark('mount', () => <RechartsScatter data={points} />);
benchmark(
  'zoom',
  () => <RechartsScatter data={points} />,
  async ({ input }) => {
    await input.pinch({ x: 400, y: 300, scaleFactor: 2 });
  },
);
```

Under the interleaved engine every variant gets a page of its own that loads only its own module, so
no variant's code, styles or module state is present while another is measured; all variants come
from the working tree. Under Vitest, which has no notion of variants, each variant's cases simply run
as tests of their own, named `mount [recharts]`.

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

### Custom drivers

`benchmark()` loops over `runCase()`, which mounts, interacts with and unmounts a case exactly once. Call it directly to control the iterations yourself — e.g. to alternate two variants so machine drift affects both equally, warming each one up right before it is measured:

```tsx
import { runCase } from '@mui/internal-benchmark';

it('A/B', async () => {
  for (let i = 0; i < 20; i += 1) {
    await runCase(renderA, interaction, { warmup: true });
    const a = await runCase(renderA, interaction);

    await runCase(renderB, interaction, { warmup: true });
    const b = await runCase(renderB, interaction);

    // compare a.renders with b.renders, check a.renderError, ...
  }
});
```

`runCase()` takes the same `renderFn`, interaction and `afterEach`/`reactRecordingPaused` options as `benchmark()`, plus `warmup`, which skips `bench:paint` and drops custom metrics for that iteration. It registers and asserts nothing. Measured iterations record metrics against the running Vitest test, so call it from inside one.

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

## Tachometer

`benchmark tacho run` measures a harness package in a real browser, building the workspace once per
commit under comparison and serving the pages from those builds. Run it from the harness.

A harness is a package holding a `src/` tree of **case folders**, each with a page and a plain,
unmodified [tachometer config](https://github.com/google/tachometer#config-file). The configs are the
source of truth for which pages exist: the runner reads the selected ones, works out which pages they
reference, builds one variant per distinct commit, and rewrites each url to the built page. Filtering
to one case therefore narrows the build too.

Sampling — `sampleSize`, `autoSampleConditions`, `timeout` — is set per case in its own config,
because tachometer rejects those as flags once a config file is in play. A case samples until its
difference resolves or the timeout is hit; two builds of equal speed cannot be separated, so such a
case reports `unsure`, which is the expected "nothing changed" outcome rather than a failure.

### What a case compares

A case is one of two things, and its `expand` decides which.

**No `expand`** is the ordinary regression shape. It is expanded for you into `[current]` — the
working tree — against `[baseline]`, both loading the same page:

```jsonc
{ "benchmarks": [{ "name": "init", "url": "./index.html" }] }
```

**Its own `expand`** compares the pages it names with each other, every one of them built from the
working tree. That is how one implementation is measured against another:

```jsonc
"expand": [
  { "name": "[mosaic]", "url": "./index.html" },
  { "name": "[tanstack]", "url": "./tanstack.html" }
]
```

Such a case reports no regression, by construction: there is no baseline in it to regress against.
Every run says which shape each case has before it starts, so this is visible rather than inferred
from an empty result. To sweep a parameter and still measure it against the baseline, give each
value its own case folder pointing at the shared page — `expand` would turn the case into the other
shape.

### Baselines

`--baseline` names the build every `[baseline]` variant loads: a revision — a SHA, a tag, a branch,
`HEAD~1` — on its own or behind `git:`. It is resolved to an immutable SHA before anything is
cached, and defaults to `HEAD~1`, which needs no policy to decide.

Which commit a branch should actually be compared against is `code-infra baseline`'s question — it
answers the same way for every job that compares a branch to its base — so pass it in:

```bash
benchmark tacho run --baseline "$(code-infra baseline)"
```

`github:<owner>/<repo>#<sha>` and `preview:<sha>` are reserved for a baseline that is not a commit in
this repository. Neither is implemented, and both are rejected by name rather than handed to git.

### Builds and caching

Both sides are built the same way, from packed tarballs installed into an isolated tree, so neither
resolves the library through a workspace link. The benchmark pages themselves stay on the current
branch and only the built library changes between refs — so a commit whose public API differs from
today's pages will fail that ref's build, with the error surfaced.

Packed builds are cached by commit SHA under `.tachometer/packed/`, so repeating a comparison against
the same commit skips the rebuild; the working tree is never cached. In CI, cache that directory
keyed on the baseline SHA, and check out with full history so a fork point can be resolved. A run
never modifies the checkout it was started from.

By default a run resolves **in place**: it pins the packed build in the repository's own
`pnpm-workspace.yaml`, installs it there, and resolution is then ordinary. The repository is put
back, and reinstalled, when the run ends — including when it fails, and at the start of the next run
if one was killed outright. Two things follow from it. A tracked file names tarballs under
`.tachometer/` until the run ends, so do not commit while one is in flight. And the pins are global
to the workspace for that time, because pnpm scopes an override by parent package name and a harness
has none — so nothing else should build against the same checkout meanwhile.

`--resolve-mode isolated` avoids both: it installs each ref into a directory of its own and points
resolution there, leaving the repository untouched, at the cost of a second install tree per ref.

`--no-install` skips a ref's install. `benchmark tacho run --help` lists the rest, and
`benchmark tacho report` prints the table again from a saved JSON report.

### Interleaved engine

`--engine interleaved` measures the same builds without tachometer: it drives Chromium through
Playwright, samples every variant once per round in a shuffled order, and judges a difference on the
per-round differences rather than on two independent sets of samples. Whatever the machine was doing
during a round — thermal throttling, a background process — then affects both sides of it and
cancels out, instead of counting as noise or, worse, as a difference. The report, the upload and the
PR comment are the same as tachometer's.

It runs two kinds of case side by side:

- **`tachometer.json` cases**, unchanged. Every sample is a fresh page load, measured by the
  `performance.measure` entry (or `fcp`) the case names. Other measurement modes are tachometer-only.
- **`*.bench.tsx` files** under `src/`, written with `benchmark()` exactly as for Vitest. The plugin
  generates a page per file under `src/__bench__/`, where `@mui/internal-benchmark` resolves to a page
  runtime instead of Vitest. The page stays open, so every sample is one warm iteration and
  module-scope data is built once; renders, `bench:paint` and custom metrics are reported as
  measurements. The iteration counts in `benchmark()`'s options are ignored — `--samples` and
  `--warmup` decide.

```bash
benchmark tacho run --engine interleaved --baseline "$(code-infra baseline)" --samples 30
```

Every variant runs in a browser context of its own, but a context's renderer process keeps whatever
speed it started with — on a machine with performance and efficiency cores, which kind it landed on
— and two identical builds can differ by several percent for as long as their processes live. Page
loads are therefore dealt out over the contexts anew every round. A `*.bench.tsx` page has to stay
open to stay warm, so its rounds run in epochs instead (`--epoch-size`, 10 rounds by default): each
epoch reopens the pages in fresh processes and warms them up again, so the process a build lands on
is drawn once per epoch rather than once per case.

## API

- `benchmark` — define a benchmark test case
- `compare` — compare implementations, each a lazily loaded module of `benchmark()` cases
- `runCase` — run a single iteration of a case, for custom drivers
- `ElementTiming` — invisible marker component for paint timing (renders a `<span>` tracked by the Element Timing API)
- `ScalarMetric` — record a continuous custom measurement (with a `console.time`-style timing helper)
- `DiscreteMetric` — record a discrete custom count
- `createBenchmarkVitestConfig` — create a Vitest config with browser benchmarking defaults
- `BenchmarkReporter` — Vitest reporter that collects and outputs benchmark results
