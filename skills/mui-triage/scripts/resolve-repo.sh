#!/usr/bin/env bash
# Print the first mui/<repo> found in the checkout's GitHub remotes.
# Usage: resolve-repo.sh [checkout]
set -euo pipefail

CHECKOUT="${1:-.}"

while IFS= read -r REMOTE; do
  URL="$(git -C "$CHECKOUT" remote get-url "$REMOTE")"
  case "$URL" in
    git@github.com:mui/*)
      REPO="${URL#git@github.com:}"
      ;;
    https://github.com/mui/*)
      REPO="${URL#https://github.com/}"
      ;;
    ssh://git@github.com/mui/*)
      REPO="${URL#ssh://git@github.com/}"
      ;;
    *)
      continue
      ;;
  esac

  printf '%s\n' "${REPO%.git}"
  exit 0
done < <(git -C "$CHECKOUT" remote)

printf 'No mui GitHub remote found in %s\n' "$CHECKOUT" >&2
exit 1
