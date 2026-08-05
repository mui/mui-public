#!/usr/bin/env bash
# Print the label names of a GitHub repo, one per line, via a local cache.
# Usage: list-labels.sh <owner/repo> [--refresh]
#   --refresh  bypass the cache and refetch (use when a label seems missing)
# Cache: <git toplevel>/node_modules/.cache/mui-triage/labels-<owner>-<repo>.txt, max 3 days old.
set -euo pipefail

REPO="${1:?usage: list-labels.sh <owner/repo> [--refresh]}"
REFRESH="${2:-}"

CACHE_DIR="$(git rev-parse --show-toplevel)/node_modules/.cache/mui-triage"
CACHE_FILE="$CACHE_DIR/labels-${REPO//\//-}.txt"

# stale = missing, empty, or older than 3 days
if [ "$REFRESH" = "--refresh" ] || [ ! -s "$CACHE_FILE" ] \
  || [ -z "$(find "$CACHE_FILE" -mtime -3 2>/dev/null)" ]; then
  mkdir -p "$CACHE_DIR"
  gh label list --repo "$REPO" --limit 500 --json name --jq '.[].name' > "$CACHE_FILE"
fi

cat "$CACHE_FILE"
