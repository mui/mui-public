---
name: circleci-why-flaky
description: Classify recent CircleCI workflow failures into buckets so you can see what's flake vs what's a real bug. Use when CI on a branch is failing repeatedly and you want to know whether retries will fix it. Infers project + branch from the current git repo; defaults to last 7 days.
---

# CircleCI: why is it flaky?

Bucket recent CircleCI failures by root cause and tell the user which buckets are fixable flake, external outage, or real bug.

## How to invoke

Two steps: the script fetches data into a directory of plain text files; you classify by iterative pattern discovery with `grep`.

### Step 1 — set up and fetch

**Already fetched?** If you were given a data directory that holds `summary.txt` and a `jobs/` directory, skip this step entirely: that directory is `$OUT`, and you go straight to step 2. Automation fetches the data itself so the CircleCI token never has to be readable while you run.

**Already finished?** Whoever ran the fetcher, if `$OUT/report.md` exists then there was nothing to classify — no failed jobs — and the fetcher has already written the whole report. Publish it as-is and stop; there is no bucketing to do.

Otherwise, generate an output directory under `.claude/cache/` (gitignored) and run the fetcher in one command:

```bash
mkdir -p .claude/cache && OUT=$(mktemp -d .claude/cache/cci-flake.XXXXXX) && node .claude/skills/circleci-why-flaky/fetch.mjs --out "$OUT" && echo "$OUT"
```

That path assumes this skill is the repo's own `.claude/skills` copy. Loaded from anywhere else — as a plugin, say — the fetcher is next to this file rather than under `.claude/`, and nothing in a Bash command expands to the skill's own directory (`CLAUDE_PLUGIN_ROOT` reaches hooks and MCP servers, not tool calls). Such a caller should either pre-fetch the data itself, as above, or state the absolute path to `fetch.mjs` when it asks for the triage.

The printed path is your working directory for this run. **Remember it** — every subsequent Bash call must substitute the literal path, because each Bash call runs in a fresh shell so `$OUT` does not persist. Below the skill writes `$OUT` for readability; substitute the actual path each time.

Common flags:

- `--branch <name>` — branch to analyze (default: current branch; pass `master`/`main` for the trunk)
- `--workflow <name>` — restrict to a single workflow name (default: all workflows on the branch)
- `--days <N>` — time window (default: 7)
- `--max <N>` — cap on failed workflows to deep-analyze (default: 200)
- `--org`, `--repo`, `--vcs` — override repo inference if not in a git repo
- `--token <token>` — explicit token (overrides `~/.circleci/cli.yml`)
- `--out <dir>` — **required**, output directory
- `--cache-dir <dir>` — raw log cache (default: `.claude/cache/circleci-why-flaky-cache`, shared across runs)

Progress goes to stderr. Stdout prints the output directory path on success.

Exit codes: `0` success, `2` bad input/missing flag, `3` auth needed.

Output layout:

```text
$OUT/
├── summary.txt        # PROJECT=, BRANCH=, TOTAL_WORKFLOWS=, FAILED_WORKFLOWS=, FAILURE_RATE_PCT=, FAILED_JOBS=
├── report.md          # only when FAILED_JOBS=0: the finished report, nothing left to classify
└── jobs/
    ├── 0000.txt       # most recent failure (lower index = more recent)
    ├── 0001.txt
    └── ...
```

Each `NNNN.txt` is a `KEY=VALUE` header block (`URL=`, `JOB=`, `WORKFLOW=`, `STATUS=`, `TIMED_OUT=`, `TIME=`, `COMMIT=`), a blank line, then the last \~4KB of each failed step's log.

### Step 2 — classify by iterative pattern discovery

**Don't read every job upfront.** Discover patterns one at a time. This scales whether there are 5 failures or 500.

Keep a working list in your head as you go:

```text
markers = [
  { marker, category, label }
  ...
]
```

`category` is one of `fixable`, `external`, `real`. `marker` is an extended regex (`grep -E`) — escape regex metacharacters (`.`, `(`, `[`, `?`, etc.) if you mean them literally.

**Loop:**

1. **Find the next unclassified job.**

   First iteration (no markers yet):

   ```bash
   ls "$OUT/jobs/" | sort | head -1
   ```

   Later iterations — `RE` is the alternation of all collected markers:

   ```bash
   RE='heap out of memory|TargetClosedError|ERR_PNPM_FETCH'
   grep -LE "$RE" "$OUT"/jobs/*.txt | sort | head -1
   ```

   `grep -L` lists files **without** a match. Empty output means every job is classified — break.

2. **Read the file** (`cat <path>`). Identify a short, distinctive marker that captures _this class_ of failure:
   - Broad enough to catch similar failures (so you don't add one marker per job).
   - Narrow enough to avoid false positives across other classes.
   - Prefer a stable error string from the failing tool (e.g. `heap out of memory`, `ERR_PNPM_FETCH`, `TargetClosedError`), not a transient bit like a timestamp or PID.

3. **Decide the category and a short label.** See the category guide below.

4. **Append `{ marker, category, label }` to `markers`.** Repeat from step 1.

**Final counts.** Once the loop ends, for each marker get the count and the most-recent matching example URL:

```bash
PATTERN='heap out of memory'
# Count of jobs matching this marker
grep -lE "$PATTERN" "$OUT"/jobs/*.txt | wc -l
# Example URL — lowest-numbered matching file is the most recent
grep -lE "$PATTERN" "$OUT"/jobs/*.txt | sort | head -1 | xargs grep -m1 '^URL=' | cut -d= -f2-
```

If a job matches multiple markers, the earlier (broader) one wins. Pick distinct enough markers that overlap is small — if counts sum to more than `FAILED_JOBS`, tighten the broader markers.

## Category guide

**fixable** — infra flake we own. Worth filing/digging into.

- Out of memory (`heap out of memory`, allocation failed)
- Browser/headless test crashes mid-run (page/context/browser closed, driver disconnected)
- Hung process — `TIMED_OUT=true` in the header with no external-outage signal
- Disk full (`no space left on device`)
- Flaky-by-design tests (timing races, port conflicts, leaked state)

**external** — third-party service down. Just retry when it recovers.

- Package registry unreachable (`ERR_PNPM_FETCH`, `registry.npmjs.org` errors)
- OS mirror down (`archive.ubuntu.com`, `security.ubuntu.com` unreachable)
- GitHub down (auth/clone/API failures against `github.com`)
- CircleCI infra hiccup (checkout failures, runner provisioning errors)
- DNS/connectivity to a clearly external host

Generic `ECONNRESET` / `ETIMEDOUT` without an identifiable third-party host is ambiguous — lean **fixable** unless the surrounding context names an external service.

**real** — code/config defect. Retry won't help.

- TypeScript compile error (`error TS<digits>:`)
- ESLint error (`<N> problems (<N> errors`)
- Test assertion failure (`AssertionError`, `Expected:`/`Received:`)
- Build/bundler error (module not found, syntax error, unresolved import)
- Snapshot or generated-artifact drift

These are starting points, not closed sets. If a clearly recurring novel pattern appears, give it its own bucket with a short label.

## Output shape

Three sections, in this order. Skip any section with zero entries.

```text
# <PROJECT> `<BRANCH>` — last <DAYS> days

**<FAILED_WORKFLOWS>/<TOTAL_WORKFLOWS>** workflow runs failed (<FAILURE_RATE_PCT>% failure rate). **<FAILED_JOBS>** failed jobs classified.

**Fixable flake** (<sum %>):
- N times, P%, <label>, [example](workflow url)
- ...

**External outage** (<sum %>):
- N times, P%, <label>, [example](workflow url)
- ...

**<N> real issues (not flaky)** — code or config bugs, not bucketed individually.
```

Rules:

- Within each section, sort by count desc.
- Render the example as a **clickable markdown link**: `[example](https://app.circleci.com/...)`. Never paste the bare URL — the brackets must be present so it renders as a link.
- Use the most recent matching job's `URL` value (from the file header) as the link target.
- Real issues are summarised on a single line with a total count — do not list each one.
- If you couldn't fit a job under any marker, add a bucket "unclassified (manual inspection needed)" inside **Fixable flake**.
- Cap the report at **10 flake buckets total** across **Fixable flake** + **External outage** combined, picking the largest by count. If you had to drop any, add one trailing line: `- <N> other long-tail flake (<P>%) — smaller patterns rolled up.`

End with a one-line bottom line: should the user retry, dig in, or wait for the outage to clear.

## Notes

- Don't reimplement the fetching logic; just run the script. It paginates pipelines, parallel-fetches workflows / jobs / step logs, strips ANSI, and caches raw log responses under `.claude/cache/circleci-why-flaky-cache/` (shared across runs) so re-runs in the same session are fast.
- The cache dir and per-run output dir both live under `.claude/cache/`, which is gitignored.
- For private projects without a valid token, the script exits with setup instructions; relay them to the user:

  ```bash
  # macOS
  brew install circleci

  # Linux / other
  curl -fLSs https://raw.githubusercontent.com/CircleCI-Public/circleci-cli/main/install.sh | bash

  # Then authenticate (writes ~/.circleci/cli.yml):
  circleci setup
  ```
