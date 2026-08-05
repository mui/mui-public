#!/usr/bin/env bash
# Create or update the marked triage comment from a file.
# Usage: upsert-comment.sh <owner/repo> <issue-number> <comment-file>
set -euo pipefail

REPO="${1:?usage: upsert-comment.sh <owner/repo> <issue-number> <comment-file>}"
NUM="${2:?usage: upsert-comment.sh <owner/repo> <issue-number> <comment-file>}"
COMMENT_FILE="${3:?usage: upsert-comment.sh <owner/repo> <issue-number> <comment-file>}"

if [ ! -f "$COMMENT_FILE" ]; then
  printf 'Comment file not found: %s\n' "$COMMENT_FILE" >&2
  exit 1
fi

COMMENT_ID=$(gh issue view "$NUM" --repo "$REPO" --json comments \
  --jq '[.comments[] | select(.body | startswith("<!-- mui-triage -->"))] | last | .url // "" | split("-") | last')

if [ -n "$COMMENT_ID" ]; then
  gh api "repos/$REPO/issues/comments/$COMMENT_ID" --method PATCH -F body=@"$COMMENT_FILE"
else
  gh issue comment "$NUM" --repo "$REPO" --body-file "$COMMENT_FILE"
fi
