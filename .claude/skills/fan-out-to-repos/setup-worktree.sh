#!/usr/bin/env bash
# scripts/setup-worktree.sh REPO_PATH [LABEL]
#
# Creates a git worktree on the given repo at:
#   $XREPO_WORKTREE_ROOT/<repo-basename>-<label>-<short-id>
# on a new branch:
#   claude-fan-out/<repo-basename>-<label>-<short-id>
#
# Prints two lines to stdout for the parent agent to parse:
#   WORKTREE_PATH=<absolute path>
#   BRANCH=<branch name>
#
# All diagnostics go to stderr.

set -euo pipefail

REPO_PATH="${1:-}"
LABEL="${2:-task}"

if [ -z "$REPO_PATH" ]; then
  echo "Usage: $0 REPO_PATH [LABEL]" >&2
  exit 2
fi

if ! git -C "$REPO_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not a git repo: $REPO_PATH" >&2
  exit 1
fi

# Resolve to absolute, canonical path
REPO_PATH=$(cd "$REPO_PATH" && pwd)
REPO_BASENAME=$(basename "$REPO_PATH")

# Worktree root — override with XREPO_WORKTREE_ROOT
WORKTREE_ROOT="${XREPO_WORKTREE_ROOT:-$HOME/.claude-xrepo-worktrees}"
mkdir -p "$WORKTREE_ROOT"

# Sanitize label (alnum, dash, underscore only)
LABEL_CLEAN=$(echo "$LABEL" | tr -c 'a-zA-Z0-9_-' '-' | sed 's/-\+/-/g;s/^-//;s/-$//')
SHORT_ID=$(date +%s%N | sha256sum | head -c 6)

SLUG="${REPO_BASENAME}-${LABEL_CLEAN}-${SHORT_ID}"
WORKTREE_PATH="$WORKTREE_ROOT/$SLUG"
BRANCH="claude-fan-out/$SLUG"

echo "Creating worktree of $REPO_PATH at $WORKTREE_PATH on branch $BRANCH" >&2
git -C "$REPO_PATH" worktree add -b "$BRANCH" "$WORKTREE_PATH" >&2

# Machine-readable output for the parent agent
echo "WORKTREE_PATH=$WORKTREE_PATH"
echo "BRANCH=$BRANCH"
