#!/usr/bin/env bash
# Set (or rotate) the read-only CircleCI token the flake-fix workflow uses on the private base-ui
# repos. The token is a CircleCI personal API token from a read-only account; it caps at one year,
# so it needs replacing yearly.
#
# It is stored as a CIRCLECI_TOKEN secret in a `flake-fix` GitHub Environment whose deployment-branch
# rule is each repo's default branch. That way only default-branch runs — the weekly cron and a
# maintainer's manual dispatch — can read it; a feature-branch push cannot.
#
# Idempotent: it creates the environment and branch rule when missing, then writes the secret. Run it
# once to set a repo up, and again each rotation to replace the value. Public base-ui reads CircleCI
# unauthenticated and needs no token, so it is intentionally absent.
#
# Prerequisites: `gh` authenticated as someone with admin on the repos below, and a read-only
# CircleCI token to paste when prompted.
#
# Usage: .github/flake-fix/rotate-circleci-token.sh
set -euo pipefail

ENVIRONMENT=flake-fix
REPOS=(
  mui/base-ui-charts
  mui/base-ui-mosaic
  mui/base-ui-plus
)

printf 'Read-only CircleCI token: '
read -rs TOKEN
printf '\n'
if [ -z "$TOKEN" ]; then
  echo 'error: no token entered' >&2
  exit 1
fi

for repo in "${REPOS[@]}"; do
  branch=$(gh repo view "$repo" --json defaultBranchRef --jq '.defaultBranchRef.name')

  # Environment restricted to the default branch: custom_branch_policies with only that branch
  # allowed. Re-running keeps any existing branch rules, so this stays idempotent.
  gh api -X PUT "repos/$repo/environments/$ENVIRONMENT" --input - >/dev/null <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON

  have=$(gh api "repos/$repo/environments/$ENVIRONMENT/deployment-branch-policies" \
    --jq '.branch_policies[].name' 2>/dev/null || true)
  if ! printf '%s\n' "$have" | grep -qxF "$branch"; then
    gh api -X POST "repos/$repo/environments/$ENVIRONMENT/deployment-branch-policies" \
      -f "name=$branch" >/dev/null
  fi

  printf '%s' "$TOKEN" | gh secret set CIRCLECI_TOKEN --repo "$repo" --env "$ENVIRONMENT"
  echo "updated $repo ($ENVIRONMENT, allowed branch: $branch)"
done

echo 'done'
