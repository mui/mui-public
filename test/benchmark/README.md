# Benchmark smoke test

A working harness for the `benchmark` CLI, used to exercise that tooling end to end.

Its benchmarks are deterministic workloads, not numbers worth tracking: they give the pipeline something
real to drive. For real benchmarks, see `base-ui-mosaic` and `base-ui-charts`.

## What it covers

| Benchmark file                | Covers                                                                    |
| :---------------------------- | :------------------------------------------------------------------------ |
| `workload/workload.bench.tsx` | The ordinary regression shape: current vs baseline, two sizes of workload |
| `list/list.bench.tsx`         | A mount, and a trusted scroll gesture with a custom metric around it      |
| `lists/lists.bench.tsx`       | Two `compare()`s of two list implementations, one per scenario            |
| `libs/sort/sort.bench.tsx`    | `compare()` of three sorts, standing in for competitor libraries          |

`workload` and `list` import `@mui/internal-test-utils` and put its value on screen. That is the
load-bearing part: every ref — the working tree included — resolves it from a packed tarball, so both sides of a comparison consume the library the way a consumer does. If that
path breaks the page fails to build, rather than quietly measuring nothing.

The `compare()` files cover the other axis, where nothing is compared across commits. Their cases
are built from the same commit and differ only in how they render or sort. A difference there is
genuinely `worse` yet must never be reported as a regression, because both sides came from the same
build.

## Running

```bash
pnpm release:build            # the harness resolves workspace packages through their build output
pnpm test:benchmark-run       # from the repo root
```

Or from here, with the usual filters and flags:

```bash
pnpm -F ./test/benchmark benchmark:run workload
pnpm -F ./test/benchmark benchmark:run --baseline HEAD
```

A filter is a case-insensitive substring of a benchmark file's path under `src/`, the way vitest
matches test files. Because both sides run identical code, the expected result is `unsure` — that is
the "no change" outcome, not a failure.

Everything a run writes goes under `.benchmark/`: the report in `results/`, the pages built per ref in
`builds/` and the packed tarballs in `packed/` (the one worth caching in CI, keyed by commit SHA).
Deleting that directory resets the harness completely.
The pages generated per benchmark file live in `src/__bench__/`, which is ignored too.

### Prerequisites

Playwright's Chromium, installed with `pnpm exec playwright install chromium`. Runs use Playwright's
pinned Chrome for Testing rather than whatever Chrome the machine has auto-updated to, so a browser
update cannot move the numbers on its own.

### A note on the baseline

The `benchmark` CLI does not work out which commit to compare against — `code-infra baseline` does, for
every job that compares a branch to its base, so bundle size and the benchmarks agree on the answer
instead of each deriving it. Pass it in:

```bash
pnpm test:benchmark-run --baseline "$(pnpm code-infra baseline)"
```

Without `--baseline` the previous commit is used.

A baseline older than the introduction of the `benchmark` CLI will fail to build its pages: this
harness's vite config imports a plugin that did not exist at that commit. `--baseline HEAD` compares
the working tree against the current commit while that is still true.

## Working on a benchmark by hand

```bash
pnpm -F ./test/benchmark dev
```

Every benchmark file's generated page is listed at `/`. `pnpm -F ./test/benchmark build` and `preview`
produce and serve the production bundle, which is what actually gets measured; the index is emitted
into that build too.
