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
part: the working tree resolves it through the workspace link to the package's build output, while
every other ref resolves it from a packed tarball in an isolated install. If either path breaks the
page fails to build, rather than quietly measuring nothing.

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

A real Chrome. Tachometer drives it over WebDriver and installs a matching `chromedriver` on demand;
the driver's major version must match Chrome's, or you will see `SessionNotCreatedError: This
version of ChromeDriver only supports Chrome version N`. Fix it by updating Chrome, or set
`browser.binary` in a case's `tachometer.json` to an existing Chromium.

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
