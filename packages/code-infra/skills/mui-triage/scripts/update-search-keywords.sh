#!/usr/bin/env bash
# Replace or append an issue's search keywords while preserving the rest of its body.
# Usage: update-search-keywords.sh <owner/repo> <issue-number> <keywords> [--dry-run]
set -euo pipefail

REPO="${1:?usage: update-search-keywords.sh <owner/repo> <issue-number> <keywords> [--dry-run]}"
NUM="${2:?usage: update-search-keywords.sh <owner/repo> <issue-number> <keywords> [--dry-run]}"
KEYWORDS="${3:?usage: update-search-keywords.sh <owner/repo> <issue-number> <keywords> [--dry-run]}"
DRY_RUN="${4:-}"

if [ -n "$DRY_RUN" ] && [ "$DRY_RUN" != "--dry-run" ]; then
  printf 'Unknown option: %s\n' "$DRY_RUN" >&2
  exit 1
fi

BODY="$(gh issue view "$NUM" --repo "$REPO" --json body --jq .body)"
INLINE_MARKER='**Search keywords**:'
SECTION_HEADING='### Search keywords'
NEXT_SECTION=$'\n### '

if [[ "$BODY" == *"$INLINE_MARKER"* ]]; then
  BEFORE="${BODY%%"$INLINE_MARKER"*}"
  AFTER="${BODY#*"$INLINE_MARKER"}"
  if [[ "$AFTER" == *$'\n'* ]]; then
    REST="${AFTER#*$'\n'}"
    BODY="${BEFORE}${INLINE_MARKER} ${KEYWORDS}"$'\n'"${REST}"
  else
    BODY="${BEFORE}${INLINE_MARKER} ${KEYWORDS}"
  fi
elif [[ "$BODY" == *"$SECTION_HEADING"* ]]; then
  BEFORE="${BODY%%"$SECTION_HEADING"*}"
  AFTER="${BODY#*"$SECTION_HEADING"}"
  if [[ "$AFTER" == *"$NEXT_SECTION"* ]]; then
    REST="${AFTER#*"$NEXT_SECTION"}"
    BODY="${BEFORE}${SECTION_HEADING}"$'\n\n'"${KEYWORDS}"$'\n\n### '"${REST}"
  else
    BODY="${BEFORE}${SECTION_HEADING}"$'\n\n'"${KEYWORDS}"
  fi
else
  BODY="${BODY%$'\n'}"$'\n\n'"${INLINE_MARKER} ${KEYWORDS}"
fi

if [ "$DRY_RUN" = "--dry-run" ]; then
  printf '%s\n' "$BODY"
  exit 0
fi

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
printf '%s\n' "$BODY" > "$BODY_FILE"
gh issue edit "$NUM" --repo "$REPO" --body-file "$BODY_FILE"
