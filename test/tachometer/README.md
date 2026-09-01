# Tachometer smoke test

A working harness for `code-infra tacho run`, used to exercise that tooling end to end.

This is **not** a meaningful benchmark, and it is not trying to be. This repository ships build and
test tooling, not a browser library, so there is nothing here whose render time is worth tracking.
The cases run a deterministic CPU workload purely so the pipeline has something real to drive:
discovering cases, resolving refs, packing a ref's workspace to tarballs, building each variant, and
running Chrome under tachometer.

For the real thing, see the consumers this tooling was extracted from — `base-ui-mosaic` and
`base-ui-charts` benchmark actual data grids and charts.

## What it covers

The two cases are chosen to walk the parts of the pipeline most likely to break:

| Case             | Covers                                                                           |
| :--------------- | :------------------------------------------------------------------------------- |
| `workload`       | The ordinary regression shape: one page, auto-expanded into current vs baseline  |
| `workload-large` | A case owning **no page of its own**, parameterising its sibling's with `?size=` |

`workload-large` is the interesting one. It exercises that a case's query parameters survive the url
rewrite, that `?ref=` is appended with `&` when a url already has a query, and that two cases
referencing one page build it only once.

Both pages import `@mui/internal-test-utils` and put its value on screen. That is the load-bearing
part: every ref — the working tree included — resolves it from a packed tarball in an isolated
install, so both sides of a comparison consume the library the way a consumer does. If that path
breaks the page fails to build, rather than quietly measuring nothing.

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

The report lands in `results/report.json`. Cases run sequentially, and each auto-samples until its
difference resolves or the (deliberately short) timeout is hit. Because both sides run identical
code, the expected verdict is `unsure` — that is the "no change" outcome, not a failure.

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

The default baseline is the fork point from the base branch, so a ref older than the introduction of
`code-infra tacho` will fail to build its pages: this harness's vite config imports a plugin that
did not exist at that commit. Pass `--baseline git:HEAD` to compare the working tree against the
current commit while that is still true.

## Working on a case by hand

```bash
pnpm -F ./test/tachometer dev
```

The dev server lists every discovered case at `/`, including `workload-large`, which owns no page
and would otherwise be invisible. `pnpm -F ./test/tachometer build:pages` and `preview` produce and
serve the production bundle, which is what actually gets measured.
