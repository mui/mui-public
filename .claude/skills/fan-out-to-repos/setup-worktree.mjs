#!/usr/bin/env node

// Usage: setup-worktree.mjs '{"repoPath": "...", "label": "...", "baseRef": "...", "worktreeRoot": "..."}'
//
// Creates a fresh git worktree on a new branch for the given repo.
//
// Inputs (JSON via argv[2]):
//   repoPath     (required) absolute path to a git repo
//   label        (optional) short slug used in branch + worktree dir name; default "task"
//   baseRef      (optional) ref to branch from; when set, --no-track is used so the new
//                branch never inherits the base ref's upstream. When unset, the branch is
//                created from the source repo's current HEAD.
//   worktreeRoot (optional) parent directory for the worktree; defaults to
//                $XREPO_WORKTREE_ROOT or ~/.claude-xrepo-worktrees
//
// Output (JSON on stdout): { worktreePath, branch, repoPath, baseRef }

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const input = JSON.parse(process.argv[2]);
const { repoPath: rawRepoPath, label = "task", baseRef = null } = input;

if (!rawRepoPath) {
  throw new Error("repoPath is required");
}

const repoPath = await realpath(rawRepoPath);

await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-dir"]);

const worktreeRoot =
  input.worktreeRoot ||
  process.env.XREPO_WORKTREE_ROOT ||
  join(homedir(), ".claude-xrepo-worktrees");

const labelClean =
  label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
const shortId = randomBytes(3).toString("hex");
const slug = `${basename(repoPath)}-${labelClean}-${shortId}`;

const worktreePath = join(worktreeRoot, slug);
const branch = `claude-fan-out/${slug}`;

await mkdir(worktreeRoot, { recursive: true });

const args = ["-C", repoPath, "worktree", "add", "-b", branch, worktreePath];
if (baseRef) {
  args.push("--no-track", baseRef);
}

await execFileAsync("git", args);

console.log(JSON.stringify({ worktreePath, branch, repoPath, baseRef }));
