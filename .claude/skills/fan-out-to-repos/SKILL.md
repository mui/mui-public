---
name: fan-out-to-repos
description: Orchestrates parallel work across multiple git repositories. For each target repo, creates a fresh worktree, spawns a repo-worker subagent inside it, then aggregates the results. MUST BE USED whenever the user wants the same task (or coordinated tasks) executed across multiple repositories — e.g. "update the README in repos A, B, and C", "bump dependency X in all our service repos", "run the test suite in each of these projects". Use proactively whenever the user names two or more distinct repos in a single request.
---

# Fan Out To Repos

Orchestrates parallel work across N repositories. The pattern: prepare a worktree per repo, spawn one `repo-worker` subagent per worktree (in parallel), aggregate results.

## When to use this skill

- The user names multiple repos to operate on.
- The user references "all our repos" / "every service" / "each of these projects" with a list.
- A change needs to land in several places independently and you want them done in parallel.

If only one repo is involved, this skill is overkill — just `cd` and work directly, or use a single Task call.

## Prerequisites

1. **Filesystem permission** for each target repo and for the worktree root. Either pre-list paths in `.claude/settings.json`'s `additionalDirectories`, or launch with `--add-dir <path>` per repo. Without this, the worker subagent's tool calls will be denied.
2. **`XREPO_WORKTREE_ROOT`** env var (optional) — where worktrees live. Defaults to `$HOME/.claude-xrepo-worktrees`. Make sure this is also in `additionalDirectories`.
3. **Clean state** in each target repo (`git status` should be clean, or at least the work shouldn't conflict with uncommitted changes — `worktree add` will fail on locked indexes etc.).

## Workflow

### Step 1 — Resolve the assignment

Get a clear list of `(repo_path, task_description)` tuples from the user. If they said "do X in all of A, B, C", you have three tuples with the same task. If they said "do X in A and Y in B", you have two tuples with different tasks.

If the repo paths are ambiguous (just names, not absolute paths), ask the user to confirm before spending tokens.

### Step 2 — Create a worktree per repo

For each tuple, run the bundled setup script. Use a short `LABEL` that hints at the task so worktree names are debuggable:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/setup-worktree.sh" /path/to/repo-A "update-readme"
```

The script prints two parseable lines to stdout:

```
WORKTREE_PATH=/home/user/.claude-xrepo-worktrees/repo-A-update-readme-a3f9c2
BRANCH=claude-fan-out/repo-A-update-readme-a3f9c2
```

Capture both values for each repo. **Do these setup calls sequentially** — they're fast, and serializing them avoids weird git index races.

If any setup fails, stop and report — don't silently skip a repo and pretend the fan-out succeeded.

### Step 3 — Fan out (parallel Task calls)

This is the critical step. **Spawn all `repo-worker` subagents in a single response** so Claude Code runs them concurrently. Sequential Task calls block on each other; multiple Task calls in one turn run in parallel.

For each tuple, call:

```
subagent_type: repo-worker
description: <short, e.g. "Update README in repo-A">
prompt: |
  WORKTREE_PATH=<absolute path from setup>
  BRANCH=<branch name from setup>

  TASK:
  <full self-contained task description — include file paths relative to
  the worktree, exact commands to run, commit message format, anything
  the worker needs. The worker has zero context from this conversation.>

  When done, report back in the format your system prompt specifies.
```

Make every prompt fully self-contained. The workers run in parallel and have no shared context; one worker cannot see what another did.

### Step 4 — Aggregate

Once all workers return, present a unified summary to the user:

| Repo | Status | Branch | Commit | Notes |
|------|--------|--------|--------|-------|
| repo-A | ✅ success | claude-fan-out/... | abc1234 | tests pass |
| repo-B | ⚠️ partial | claude-fan-out/... | def5678 | 2 of 3 tests pass |
| repo-C | ❌ failed | claude-fan-out/... | (no commit) | dependency conflict |

For each row, give the user the absolute worktree path so they can inspect or push:

```
git -C <worktree-path> push -u origin <branch>
```

### Step 5 — Cleanup (only when the user asks, or the work is finalized)

Do **not** auto-cleanup after fan-out — the user almost always wants to review or push first. When they say they're done, run for each worktree:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/cleanup-worktree.sh" <worktree-path>
```

The script refuses to delete branches with unmerged commits, so it's safe to run broadly. Pass `--keep-branch` if you want to remove just the worktree directory but preserve the branch.

## Example end-to-end

User: *"Bump the `lodash` dep to ^4.17.21 in our `web-app`, `api-server`, and `worker-service` repos. Run their test suites and report back."*

Parent agent runs the skill:

1. Confirm repo paths (assume already known: `~/code/web-app`, `~/code/api-server`, `~/code/worker-service`).
2. Sequentially run `setup-worktree.sh` for each → capture three `(WORKTREE_PATH, BRANCH)` pairs.
3. **In a single response**, fire three parallel Task calls. Each prompt:
   - Specifies the worktree path and branch.
   - Tells the worker to edit `package.json`, run `npm install`, run `npm test`, and commit with message `"chore(deps): bump lodash to ^4.17.21"`.
4. Wait for all three to return.
5. Present the aggregated table to the user.
6. Wait for the user to push / review before cleanup.

## Failure modes to watch for

- **`worktree add` fails** because the branch already exists (rerun of a previous fan-out with same label). The setup script uses a random suffix to avoid this, but if you reuse labels across sessions you might still collide. Just rerun.
- **A worker reports `failed`.** Don't retry blindly — surface the failure to the user. The worktree is left in place for inspection.
- **Permission denied on the worktree path.** Means `additionalDirectories` doesn't include it. Tell the user to add it and restart Claude Code (or use `/add-dir` mid-session if available).
- **Workers stomping on each other's changes.** Should not happen — each is in its own worktree. If it does, double-check that each Task prompt has a *different* `WORKTREE_PATH`.

## Why this design (and not `isolation: worktree` per agent)

Native `isolation: worktree` worktrees the *parent's* repo and routes through the `WorktreeCreate` hook, which is a single session-wide override that doesn't know which subagent fired it ([anthropics/claude-code#31939](https://github.com/anthropics/claude-code/issues/31939)). For a many-repos-many-workers fan-out, the orchestration approach above gives the parent explicit control over which repo each worker targets, supports true parallelism via parallel Task calls, and avoids hook-discrimination gymnastics.
