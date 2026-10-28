#!/usr/bin/env bash
# Print issue context and author-association metadata as one JSON object.
# Usage: fetch-issue.sh <owner/repo> <issue-number>
set -euo pipefail

REPO="${1:?usage: fetch-issue.sh <owner/repo> <issue-number>}"
NUM="${2:?usage: fetch-issue.sh <owner/repo> <issue-number>}"

printf '{"issue":'
gh issue view "$NUM" --repo "$REPO" \
  --json number,title,body,labels,state,author,comments,createdAt,url
printf ',"metadata":'
gh api "repos/$REPO/issues/$NUM" --jq '{authorAssociation: .author_association}'
printf '}\n'
