#!/usr/bin/env bash
# Print matching issues and pull requests as one JSON object.
# Usage: search-related.sh <owner/repo> <query>
set -euo pipefail

REPO="${1:?usage: search-related.sh <owner/repo> <query>}"
QUERY="${2:?usage: search-related.sh <owner/repo> <query>}"

printf '{"issues":'
gh issue list --repo "$REPO" --search "$QUERY" --state all --limit 20 \
  --json number,title,state,url
printf ',"pullRequests":'
gh pr list --repo "$REPO" --search "$QUERY" --state all --limit 20 \
  --json number,title,state,url
printf '}\n'
