#!/usr/bin/env node

// Usage: cleanup-worktree.mjs '{"worktreePath": "...", "keepBranch": false}'
//
// Removes a fan-out worktree created by setup-worktree.mjs. By default also deletes the
// branch IF it has no unmerged commits (uses `git branch -d`, never `-D`). Pass
// keepBranch:true to remove the worktree only.
//
// Output (JSON on stdout): { removed, ownerRepo, branch, branchDeleted }

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const input = JSON.parse(process.argv[2]);
const { worktreePath, keepBranch = false } = input;

if (!worktreePath) {
  throw new Error("worktreePath is required");
}

try {
  await access(worktreePath);
} catch {
  console.log(
    JSON.stringify({
      removed: false,
      ownerRepo: null,
      branch: null,
      branchDeleted: false,
      reason: "worktree path does not exist",
    }),
  );
  process.exit(0);
}

const { stdout: listOut } = await execFileAsync("git", [
  "-C",
  worktreePath,
  "worktree",
  "list",
  "--porcelain",
]);
const ownerMatch = listOut.match(/^worktree (.+)$/m);
const ownerRepo = ownerMatch ? ownerMatch[1] : null;

const { stdout: branchOut } = await execFileAsync("git", [
  "-C",
  worktreePath,
  "rev-parse",
  "--abbrev-ref",
  "HEAD",
]);
const branch = branchOut.trim();

await execFileAsync("git", [
  "-C",
  ownerRepo,
  "worktree",
  "remove",
  worktreePath,
  "--force",
]);

let branchDeleted = false;
if (!keepBranch && branch && branch !== "HEAD") {
  try {
    await execFileAsync("git", ["-C", ownerRepo, "branch", "-d", branch]);
    branchDeleted = true;
  } catch {
    // `git branch -d` refuses to delete unmerged branches — that's the safety net.
    // Leave the branch in place so the user can push or merge it.
  }
}

console.log(
  JSON.stringify({ removed: true, ownerRepo, branch, branchDeleted }),
);
