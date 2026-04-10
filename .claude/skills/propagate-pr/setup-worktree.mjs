#!/usr/bin/env node

// Usage: setup-worktree.mjs '{"repoPath": "...", "upstreamRemote": "...", "prNumber": 123, "sourceRepo": "mui-public", "worktreeDir": "..."}'
// Determines default branch, fetches upstream, creates worktree with branch.
// Outputs JSON with worktree path, branch name, and default branch.

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const input = JSON.parse(process.argv[2]);
const { repoPath, upstreamRemote, prNumber, sourceRepo, worktreeDir } = input;

// Determine default branch
const { stdout: lsRemoteOut } = await execFileAsync("git", [
  "-C",
  repoPath,
  "ls-remote",
  "--symref",
  upstreamRemote,
  "HEAD",
]);

let defaultBranch = "master";
const symrefMatch = lsRemoteOut.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
if (symrefMatch) {
  defaultBranch = symrefMatch[1];
}

// Fetch upstream
await execFileAsync("git", ["-C", repoPath, "fetch", upstreamRemote]);

// Create worktree directory parent
await mkdir(dirname(worktreeDir), { recursive: true });

// Create worktree + branch
const branchName = `propagate/${sourceRepo}-pr-${prNumber}`;
await execFileAsync("git", [
  "-C",
  repoPath,
  "worktree",
  "add",
  worktreeDir,
  "-b",
  branchName,
  `${upstreamRemote}/${defaultBranch}`,
]);

console.log(
  JSON.stringify({
    worktreeDir,
    branchName,
    defaultBranch,
  }),
);
