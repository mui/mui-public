# Tachometer smoke test

A working harness for `benchmark tacho run`, used to exercise that tooling end to end.

This is **not** a meaningful benchmark, and it is not trying to be. This repository ships build and
test tooling, not a browser library, so there is nothing here whose render time is worth tracking.
The cases run a deterministic CPU workload purely so the pipeline has something real to drive:
discovering cases, resolving refs, packing a ref's workspace to tarballs, building each variant, and
running Chrome under tachometer.

For the real thing, see the consumers this tooling was extracted from — `base-ui-mosaic` and
`base-ui-charts` benchmark actual data grids and charts.

## What it covers

The cases are chosen to walk the parts of the pipeline most likely to break:

| Case             | Covers                                                                           |
| :--------------- | :------------------------------------------------------------------------------- |
| `workload`       | The ordinary regression shape: one page, auto-expanded into current vs baseline  |
| `workload-large` | A case owning **no page of its own**, parameterising its sibling's with `?size=` |
| `libs-sort`      | Three variants from **one build**: the cross-library shape, with no ref in sight |

`workload-large` exercises that a case's query parameters survive the url rewrite, that `?ref=` is
appended with `&` when a url already has a query, and that two cases referencing one page build it
only once.

`libs-sort` covers the other axis, where nothing is compared across commits. Its three variants are
built from the same commit and differ only in how they sort, standing in for the competitor
libraries this repository has no reason to install. It exercises three things the two-variant cases
cannot: a case with more than two variants, which the report draws as a table of variants rather
than a row per case; a second variant set, which gets a table of its own rather than sharing one
full of blank cells; and a verdict that is genuinely `slower` yet must never be reported as a
regression, because both sides came from the same build.

`workload` and `workload-large` import `@mui/internal-test-utils` and put its value on screen. That
is the load-bearing part: every ref — the working tree included — resolves it from a packed tarball
in that ref's own tree, so both sides of a comparison consume the library the way a consumer does.
If that path breaks the page fails to build, rather than quietly measuring nothing.

## Running

```bash
pnpm release:build       # the harness resolves workspace packages through their build output
pnpm test:tacho          # from the repo root
```

Or from here, with the usual filters and flags:

```bash
pnpm -F ./test/tachometer test:tacho large
pnpm -F ./test/tachometer test:tacho --baseline git:HEAD
```

A filter is a case-insensitive substring of a case's path under `src/`, the way vitest matches test
files. Cases may sit in folders, and since the path is what a filter matches, a folder name selects
everything beneath it — which is how a repository partitions its suite (a quick set for pull
requests, everything for a release) without the runner being taught what any of it means. A case is
named by its benchmark's own `name`, so moving one between folders does not rename it in the report.

Cases run sequentially, and each auto-samples until its difference resolves or the (deliberately
short) timeout is hit. Because both sides run identical code, the expected verdict is `unsure` —
that is the "no change" outcome, not a failure.

`benchmark tacho report` prints that table again from the saved JSON, so a run kept from earlier —
or a report downloaded from CI — can be read without sampling again.

Everything a run writes goes under `.tachometer/`: the report in `results/`, the pages built per ref
in `builds/`, the packed tarballs in `packed/` (the one worth caching in CI, keyed by commit SHA)
and the install each ref resolves through in `trees/`. Deleting that directory resets the harness
completely, and it is the only thing a repository has to ignore.

### Prerequisites

Playwright's Chromium, installed with `pnpm exec playwright install chromium`. Runs use Playwright's
pinned Chrome for Testing rather than whatever Chrome the machine has auto-updated to, so a browser
update cannot move the numbers on its own.

A chromedriver only drives its own Chrome major, so the root `chromedriver` devDependency has to
stay aligned with `@playwright/test` — bump the two together. `tacho run` checks the pair before it
builds anything and fails with both versions named, rather than letting you find out minutes later
through `SessionNotCreatedError`.

One wrinkle: tachometer installs a chromedriver into its own package directory on demand, and that
copy wins over the root pin. If the check reports a driver you did not install, delete
`node_modules/.pnpm/tachometer@*/node_modules/tachometer/node_modules/chromedriver` and re-run.

### A note on the baseline

`tacho run` does not work out which commit to compare against — `code-infra baseline` does, for
every job that compares a branch to its base, so bundle size and the benchmarks agree on the answer
instead of each deriving it. Pass it in:

```bash
pnpm test:tacho --baseline "git:$(pnpm code-infra baseline)"
```

Without `--baseline` the previous commit is used, which needs no policy to decide.

A ref older than the introduction of `benchmark tacho` will fail to build its pages: this harness's
vite config imports a plugin that did not exist at that commit. `--baseline git:HEAD` compares the
working tree against the current commit while that is still true.

## Working on a case by hand

```bash
pnpm -F ./test/tachometer dev
```

Every discovered case is listed at `/`, including `workload-large`, which owns no page of its own and
would otherwise be unreachable — its `?size=` query is in the config, not the file tree. The list is
generated from the case configs rather than written by hand, so it cannot go stale.

`pnpm -F ./test/tachometer build` and `preview` produce and serve the production bundle, which is
what actually gets measured. The index is emitted into that build too, so the same list is there.
