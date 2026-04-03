---
name: propagate-pr
description: >
  Propagate a PR's changes to other MUI repositories. Takes a PR URL,
  fetches the diff, and applies it across selected repos using local clones and worktrees.
argument-hint: '<pr-url>'
allowed-tools: Bash(node *), Bash(gh *), Bash(git *), Bash(mkdir *), Bash(rm *), Bash(cat *), Bash(ls *), Bash(pnpm *), Agent, AskUserQuestion, Read, Glob, Grep
---

# Propagate PR

Propagate a pull request's changes across multiple MUI repositories.

## Steps

### 1. Fetch PR details

Run `node ${CLAUDE_SKILL_DIR}/fetch-pr.mjs $ARGUMENTS`. This creates `.propagate-pr/<source-repo>/<number>/` with `metadata.json` and `diff.patch`. Read the metadata JSON for the PR title, body, number, and URL.

### 2. Select repos and locate local clones

Present the list of target repos and ask the user for each one's local path. Use `AskUserQuestion` to ask for all paths at once. Suggest `../<repo-name>` as the default for each. The user can provide a custom path or say "skip" for repos they don't want to propagate to.

Target repos:

- `mui/base-ui` (suggest `../base-ui`)
- `mui/base-ui-charts` (suggest `../base-ui-charts`)
- `mui/base-ui-mosaic` (suggest `../base-ui-mosaic`)
- `mui/base-ui-plus` (suggest `../base-ui-plus`)
- `mui/material-ui` (suggest `../material-ui`)
- `mui/mui-x` (suggest `../mui-x`)
- `mui/mui-public` (suggest `../mui-public`)
- `mui/mui-private` (suggest `../mui-private`)

Exclude the source repo (the one the PR is from) from the list.

Once the user has provided paths, run `node ${CLAUDE_SKILL_DIR}/inspect-repos.mjs '<json>'` where `<json>` is `{"repos": [{"repo": "<repo-name>", "path": "<user-provided-path>"}, ...]}`. This checks all repos in parallel and returns a JSON array with each repo's status:

- `"ok"`: found upstream/push remotes, includes `upstreamRemote`, `pushRemote`, `forkOwner`, `isDirect`
- `"not_found"`: path doesn't exist or isn't a git repo — suggest the user fork and clone it:
  ```
  gh repo fork mui/<repo-name> --clone -- <suggested-path>
  ```
  Ask them to run this and retry, or skip.
- `"no_upstream"`: no remote points to `mui/<repo>` — warn and skip.

For `isDirect: true` repos (no fork remote, push goes directly to `mui/`), that's fine.

### 3. Launch one subagent per repo (in parallel)

**CRITICAL**: Launch ALL subagents in a **single message** with multiple Agent tool calls. This is the only way to run them in parallel. Do NOT launch them one at a time.

Launch a **general-purpose Agent** for each selected repo. Each subagent receives:

- The diff file path (the temp file from step 1)
- The local repo path
- The upstream repo identifier (e.g., `mui/base-ui`)
- The original PR title, body, and URL
- The upstream remote name
- The push remote name

**Subagent instructions** (include all of this in the agent prompt):

1. **Set up the worktree**: Run `node ${CLAUDE_SKILL_DIR}/setup-worktree.mjs '<json>'` where `<json>` is:
   ```json
   {
     "repoPath": "<local-repo-path>",
     "upstreamRemote": "<upstream-remote-name>",
     "prNumber": <number>,
     "sourceRepo": "<source-repo-name>",
     "worktreeDir": "<absolute-path-to-.propagate-pr/<target-repo>/<number>>"
   }
   ```
   This determines the default branch, fetches upstream, and creates the worktree + branch in one call. It returns JSON with `worktreeDir`, `branchName`, and `defaultBranch`.

2. **Apply the diff** in the worktree (at `.propagate-pr/<target-repo>/<number>`):

   ```
   cd <worktree-path>
   git apply --3way <diff-file>
   ```

   If `git apply --3way` produces conflicts, use the full PR context (diff, title, body) to understand the intent and resolve conflicts. Read the conflicting files, understand what the PR was trying to change, and apply the same logical change.

3. **Install and dedupe**:

   ```
   pnpm install --no-frozen-lockfile
   pnpm dedupe
   ```

4. **Run validation** (adapt to the target repo's scripts — check `package.json`):

   ```
   pnpm prettier --write .
   pnpm eslint --fix
   pnpm typescript
   ```

   If the repo uses different script names (e.g., `pnpm lint`, `pnpm typecheck`, `pnpm tsc`), use those instead. Check `package.json` scripts first.

5. **Commit** with the original PR title as the commit message.

6. **Push** to the push remote:

   ```
   git push <push-remote> propagate/<source-repo>-pr-<number>
   ```

7. **Report back**: Return the branch name, success/failure status, any issues encountered, and the **full filesystem path of the worktree**.

8. Do **NOT** open a PR. Do **NOT** clean up the worktree.

### 4. Confirm before opening PRs

Collect results from all subagents. Present a summary:

- Which repos succeeded/failed
- The **full filesystem path of each worktree** (so the user can inspect)
- Any issues encountered

Use `AskUserQuestion` to get **explicit confirmation** before opening any PRs. Never open a PR without confirmation.

### 5. Open draft PRs

For each confirmed repo, create a draft PR:

```
gh pr create --repo mui/<repo-name> --draft \
  --title "<original PR title>" \
  --body "Propagated from <original PR URL>" \
  --head <fork-owner>:propagate/<source-repo>-pr-<number>
```

- If the push remote is a fork (owner is not `mui`), use `--head <fork-owner>:propagate/...`
- If it's a direct clone (owner is `mui`), use `--head propagate/...` (no owner prefix)

### 6. Print PR links

Output a summary list with a clickable link for every opened PR.

### 7. Offer to comment on the original PR

Show the user a preview of the comment that would be posted, then ask if they want to post it using `AskUserQuestion`. The comment format:

```
Propagated to:
- [ ] <pr-url-1>
- [ ] <pr-url-2>
- [ ] <pr-url-3>
```

If confirmed, post with `gh pr comment <original-pr-url> --body "<comment>"`.
