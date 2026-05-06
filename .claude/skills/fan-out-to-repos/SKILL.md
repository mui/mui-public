---
name: fan-out-to-repos
description: Orchestrates parallel work across multiple git repositories. For each target repo, creates a fresh worktree, spawns a repo-worker subagent inside it, then aggregates the results. MUST BE USED whenever the user wants the same task (or coordinated tasks) executed across multiple repositories — e.g. "update the README in repos A, B, and C", "bump dependency X in all our service repos", "run the test suite in each of these projects". Use proactively whenever the user names two or more distinct repos in a single request.
---

# Fan Out To Repos

Orchestrates parallel work across N repositories. The pattern: prepare a worktree per repo, spawn one `repo-worker` subagent per worktree (in parallel), aggregate results.

## When to use this skill

- The user names multiple repos to operate on, or refers to "all our repos" / "every service" with a list.
- A change needs to land in several places independently and you want them done in parallel.

If only one repo is involved, this skill is overkill — just `cd` and work directly.

## Prerequisites

- **Filesystem permission** for each target repo and for the worktree root. Either pre-list paths in `.claude/settings.json`'s `additionalDirectories`, or launch with `--add-dir <path>` per repo. Without this, the worker subagent's tool calls will be denied.
- **`XREPO_WORKTREE_ROOT`** env var (optional) — where worktrees live. Defaults to `~/.claude-xrepo-worktrees`. Make sure it's also in `additionalDirectories`.
- **Clean enough state** in each target repo. `worktree add` will fail on a locked index.

## Workflow

### Step 1 — Resolve the assignment

Get a list of `(repo_path, task_description)` tuples from the user. If the repo paths are ambiguous (just names, not absolute paths), confirm before spending tokens.

### Step 2 — Create a worktree per repo

For each tuple, run `setup-worktree.mjs` with a JSON arg. Use a short `label` that hints at the task so worktree names are debuggable. Pass `baseRef` when the new branch should branch off a remote-tracking ref (e.g. `upstream/main`) rather than the source repo's current `HEAD` — `--no-track` is always applied so a later `git push -u <remote>` creates the right upstream and never accidentally pushes to the base ref.

```bash
node "${CLAUDE_SKILL_DIR}/setup-worktree.mjs" '{"repoPath":"/path/to/repo-A","label":"update-readme"}'
```

```bash
node "${CLAUDE_SKILL_DIR}/setup-worktree.mjs" '{"repoPath":"/path/to/repo-A","label":"apply-pr-1234","baseRef":"upstream/main"}'
```

The script prints a single JSON line on stdout:

```json
{"worktreePath":"/home/you/.claude-xrepo-worktrees/repo-A-update-readme-a3f9c2","branch":"claude-fan-out/repo-A-update-readme-a3f9c2","repoPath":"/path/to/repo-A","baseRef":null}
```

Capture `worktreePath` and `branch` for each repo. **Run setup calls sequentially** — they're fast, and serializing avoids git index races. If any setup fails, stop and report.

### Step 3 — Fan out (parallel Task calls)

This is the critical step. **Spawn all `repo-worker` subagents in a single response** so Claude Code runs them concurrently. Sequential Task calls block on each other; multiple Task calls in one turn run in parallel.

For each tuple:

```
subagent_type: repo-worker
description: <short, e.g. "Update README in repo-A">
prompt: |
  WORKTREE_PATH=<absolute path from setup>
  BRANCH=<branch name from setup>

  TASK:
  <fully self-contained task description — file paths relative to the worktree,
  exact commands, commit message format, anything the worker needs. Workers
  share no context with each other or with you.>

  When done, report back in the format your system prompt specifies.
```

### Step 4 — Aggregate

Once all workers return, present a unified summary:

| Repo | Status | Branch | Commit | Notes |
|------|--------|--------|--------|-------|
| repo-A | ✅ success | claude-fan-out/... | abc1234 | tests pass |
| repo-B | ⚠️ partial | claude-fan-out/... | def5678 | 2 of 3 tests pass |
| repo-C | ❌ failed | claude-fan-out/... | (no commit) | dependency conflict |

For each row, give the user the absolute worktree path so they can inspect or push:

```
git -C <worktree-path> push -u origin <branch>
```

### Step 5 — Cleanup (only when the user asks)

Don't auto-cleanup — the user almost always wants to review or push first. When they say they're done, for each worktree:

```bash
node "${CLAUDE_SKILL_DIR}/cleanup-worktree.mjs" '{"worktreePath":"/abs/path"}'
```

Pass `"keepBranch":true` to remove only the directory. The script uses `git branch -d` (never `-D`), so it refuses to delete branches with unmerged commits.

## Failure modes

- **`worktree add` fails** because the branch already exists. The setup script suffixes with random bytes, but if you somehow collide, just rerun.
- **A worker reports `failed`.** Surface it; don't blindly retry. The worktree is left in place for inspection.
- **Permission denied on the worktree path.** `additionalDirectories` doesn't include it. Tell the user to add it.
- **Workers stomping on each other.** Should not happen — each is in its own worktree. If it does, double-check each Task prompt has a *different* `WORKTREE_PATH`.
