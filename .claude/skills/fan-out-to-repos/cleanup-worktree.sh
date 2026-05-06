#!/usr/bin/env bash
# scripts/cleanup-worktree.sh WORKTREE_PATH [--keep-branch]
#
# Removes the given worktree from its owning repo. By default also deletes
# the branch IF it has no unmerged commits (safe deletion). Pass --keep-branch
# to keep the branch regardless.
#
# Diagnostics to stderr; nothing to stdout on success.

set -euo pipefail

WORKTREE_PATH="${1:-}"
KEEP_BRANCH=0
[ "${2:-}" = "--keep-branch" ] && KEEP_BRANCH=1

if [ -z "$WORKTREE_PATH" ]; then
  echo "Usage: $0 WORKTREE_PATH [--keep-branch]" >&2
  exit 2
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "Worktree directory does not exist: $WORKTREE_PATH" >&2
  exit 0
fi

# Find the owning repo (first entry in worktree list is the main checkout)
OWNER_REPO=$(git -C "$WORKTREE_PATH" worktree list --porcelain 2>/dev/null \
             | awk '/^worktree /{print $2; exit}')

if [ -z "$OWNER_REPO" ]; then
  echo "Could not resolve owner repo for $WORKTREE_PATH; removing directory only" >&2
  rm -rf "$WORKTREE_PATH"
  exit 0
fi

# Capture branch BEFORE removing the worktree
BRANCH=$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

echo "Removing worktree $WORKTREE_PATH from $OWNER_REPO" >&2
git -C "$OWNER_REPO" worktree remove "$WORKTREE_PATH" --force 2>/dev/null \
  || rm -rf "$WORKTREE_PATH"

if [ "$KEEP_BRANCH" = "0" ] && [ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ]; then
  # `git branch -d` refuses to delete unmerged branches — that's the safety net
  if git -C "$OWNER_REPO" branch -d "$BRANCH" 2>/dev/null; then
    echo "Deleted branch $BRANCH (was fully merged or empty)" >&2
  else
    echo "Branch $BRANCH kept (has unmerged commits — push or merge first)" >&2
  fi
fi
