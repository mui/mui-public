---
name: circleci-why-flaky
description: Classify recent CircleCI failures as fixable flake, external outage, or real bug, so you know whether retrying will help. Use when CI keeps failing on a branch.
---

# CircleCI: why is it flaky?

Bucket recent CircleCI failures by root cause and tell the user which buckets are fixable flake, external outage, or real bug.

## How to invoke

Two steps: the script fetches the data and writes a `result.json` verdict alongside one plain text file per failed job; unless that verdict says there is nothing to do, you classify by iterative pattern discovery with `grep`.

### Step 1 — set up and fetch

**Already fetched?** If you were given a data directory that holds `result.json`, skip this step entirely: that directory is `$OUT`. Automation fetches the data itself so the CircleCI token never has to be readable while you run.

Either way, `result.json` tells you whether there is anything to do. Read it first: unless `status` is `issues`, the run is already finished and `$OUT/report.md` holds the whole report — publish that as-is and stop, there is nothing to bucket.

Otherwise, generate an output directory under `.claude/cache/` (gitignored) and run the fetcher in one command:

```bash
mkdir -p .claude/cache && OUT=$(mktemp -d .claude/cache/cci-flake.XXXXXX) && node .claude/skills/circleci-why-flaky/fetch.mjs --out "$OUT" && echo "$OUT"
```

That path assumes this skill is the repo's own `.claude/skills` copy. Loaded from anywhere else — as a plugin, say — the fetcher is next to this file rather than under `.claude/`, and nothing in a Bash command expands to the skill's own directory (`CLAUDE_PLUGIN_ROOT` reaches hooks and MCP servers, not tool calls). Such a caller should either pre-fetch the data itself, as above, or state the absolute path to `fetch.mjs` when it asks for the triage.

The printed path is your working directory for this run. **Remember it** — every subsequent Bash call must substitute the literal path, because each Bash call runs in a fresh shell so `$OUT` does not persist. Below the skill writes `$OUT` for readability; substitute the actual path each time.

Do not work around that by assigning it first (`OUT=…; grep …`). Beyond not surviving the call, a leading assignment of an unrecognised variable stops tool-approval matching from reaching the commands after it, so under a restricted allowlist the whole call is refused — including parts that would have been allowed on their own.

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

Exit codes: `0` success, `2` bad input/missing flag, `3` auth needed, `4` failures found but no logs readable.

Output layout — one `result.json` describing the run, plus the log corpus it points at:

```text
$OUT/
├── result.json        # the whole verdict — fixed size, whatever the failure count
├── report.md          # the finished report, when status is not `issues`
└── jobs/              # only when status is `issues` — one file per failed job
    ├── 0000.txt       # most recent failure (lower index = more recent)
    ├── 0001.txt
    └── ...
```

```jsonc
{
  "status": "issues", // or "clean" | "no-job-failures" (CircleCI-side) | "no-data" (broken lookup)
  "project": "gh/mui/mui-public",
  "branch": "master",
  "days": 7,
  "totals": {
    "workflows": 300,
    "failedWorkflows": 12,
    "failureRatePct": 4.0,
    "failedJobs": 27,
    "analysedWorkflows": 12, // only when there were failures; below failedWorkflows means --max truncated
  },
}
```

It carries counts and never a per-failure list, so reading it costs the same whether the window held five failures or five hundred. The failures themselves are the `jobs/*.txt` files, meant to be found with `grep` rather than read in bulk — see step 2. Take the report's header counts from `totals`. When `analysedWorkflows` is below `failedWorkflows`, the `--max` cap truncated the run: `failedJobs` then counts only the analysed slice, while `workflows` and `failedWorkflows` still cover the whole window. Say so in the report when those two differ, because every percentage you compute is against the slice.

Each `NNNN.txt` is a `KEY=VALUE` header block (`URL=`, `JOB=`, `WORKFLOW=`, `STATUS=`, `TIMED_OUT=`, `TIME=`, `COMMIT=`), a blank line, then the last \~4KB of each failed step's log.

### Step 2 — classify by iterative pattern discovery

**Don't read every job upfront.** Discover patterns one at a time. This scales whether there are 5 failures or 500.

Two rules keep it scaling, both about your own context. A job file is ~4KB per failed step and would stay with you for the rest of the session, so the loop below **never reads one directly** — a subagent does — and **stops at 12 markers**. Neither costs report quality: the report shows at most ten flake buckets, rolls every real issue into one line, and has a bucket for whatever is left over.

Keep a working list in your head as you go:

```text
markers = [
  { marker, category, label }
  ...
]
```

`category` is one of `fixable`, `external`, `real`. `marker` is an extended regex (`grep -E`) — escape regex metacharacters (`.`, `(`, `[`, `?`, etc.) if you mean them literally.

**Loop** — until either no job is left unmatched, or you hold 12 markers:

1. **Find the next unclassified job.**

   First iteration (no markers yet):

   ```bash
   ls "$OUT/jobs/" | sort | head -1
   ```

   Later iterations — the pattern is the alternation of all collected markers, written inline (each Bash call is a fresh shell, so a variable would not survive to the next one):

   ```bash
   grep -LE 'heap out of memory|TargetClosedError|ERR_PNPM_FETCH' "$OUT"/jobs/*.txt | sort | head -1
   ```

   `grep -L` lists files **without** a match. Empty output means every job is classified — break.

2. **Classify it in a subagent** — don't open the file yourself, whatever the corpus size. Dispatch one subagent whose entire task is to read that one file and reply with only `{ marker, category, label }`. The log stays in its context and three fields come back, so your own context is the same size after the tenth class as after the first.

   Give the subagent the category guide below, the markers you already hold, and these criteria for the marker:
   - A short extended regex for `grep -E`, matching a distinctive line of the failure, with metacharacters escaped where they are meant literally — you will run it verbatim.
   - Broad enough to catch similar failures (so you don't end up with one marker per job).
   - Narrow enough to avoid false positives across other classes.
   - A stable error string from the failing tool (e.g. `heap out of memory`, `ERR_PNPM_FETCH`, `TargetClosedError`), never a transient bit like a timestamp, PID, or duration.

3. **Check the marker matches the file it came from**, then append `{ marker, category, label }` to `markers` and repeat from step 1.

   ```bash
   grep -cE '<the returned marker>' "$OUT"/jobs/0007.txt
   ```

   You never saw this log, so a marker that matches nothing is a real possibility — a paraphrased error string, an unescaped `.` or `(`, a line quoted from a part of the log the 4KB tail cut off. A zero means step 1 hands you the same file again and the loop spins until the cap, so on zero ask the subagent for a marker copied verbatim from a line it can see, and only then move on.

   Overlap between markers needs no checking: the counts below give each job to the first marker that claims it, so a broad marker simply takes precedence over a later narrower one.

**Stopping at 12.** Markers past that can't reach the report — ten flake buckets is the cap and every `real` issue collapses into a single count — so discovering more only spends context. When you stop with jobs still unmatched, count them once and report that number as the "unclassified" bucket described below:

```bash
grep -LE 'heap out of memory|TargetClosedError|ERR_PNPM_FETCH' "$OUT"/jobs/*.txt | wc -l
```

**Final counts.** Once the loop ends, count each marker against the jobs no _earlier_ marker already claimed, so first-match-wins is arithmetic rather than something you have to police. For the first marker there is nothing to exclude, so its count is a plain `grep -lE … | wc -l`; for every later one, exclude the alternation of the markers before it:

```bash
# marker 2 of N: matched by this one, and by none of the ones before it
grep -lE 'TargetClosedError' "$OUT"/jobs/*.txt | xargs -r grep -LE 'heap out of memory' | wc -l
# Example URL — lowest-numbered matching file is the most recent
grep -lE 'TargetClosedError' "$OUT"/jobs/*.txt | sort | head -1 | xargs grep -m1 '^URL=' | cut -d= -f2-
```

`xargs -r` matters: on GNU xargs an empty list still runs `grep` once, with no file operands, so it reads the already-exhausted pipe and `-L` reports `(standard input)` as a non-match — counting one job in a bucket that has none. Counted this way the buckets are disjoint by construction, so they sum to at most `totals.failedJobs` — if they sum to less, the remainder is the unclassified bucket. Batch these into one Bash call separated by `;` rather than two calls per marker; each round trip costs a turn.

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

**<totals.failedWorkflows>/<totals.workflows>** workflow runs failed (<totals.failureRatePct>% failure rate). **<totals.failedJobs>** failed jobs classified.

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
- If any job is left unmatched — because it fit no marker, or because you stopped at 12 — add a bucket "unclassified (manual inspection needed)" inside **Fixable flake**, with the count from the loop's stopping step.
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
