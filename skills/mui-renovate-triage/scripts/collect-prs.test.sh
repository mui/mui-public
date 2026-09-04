#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pull_request_fixture='{
  "number": 123,
  "title": "Bump example packages",
  "url": "https://github.com/mui/example/pull/123",
  "body": "| [example](https://example.com) | [`^1.0.0` → `^2.0.0`](https://renovatebot.com/diffs/npm/example/1.0.0/2.0.0) |\n| [example](https://example.com) | [`1.0.0` → `2.0.0`](https://renovatebot.com/diffs/npm/example/1.0.0/2.0.0) |\n| [other](https://example.com) | [`^3.0.0` → `^4.0.0`](https://renovatebot.com/diffs/npm/other/3.0.0/4.0.0) |",
  "files": [{"path": "package.json"}],
  "isDraft": false,
  "mergeable": "MERGEABLE",
  "mergeStateStatus": "BLOCKED",
  "reviewDecision": "REVIEW_REQUIRED",
  "baseRefName": "master",
  "baseRefOid": "base-sha",
  "headRefOid": "head-sha",
  "updatedAt": "2026-09-04T00:00:00Z",
  "statusCheckRollup": [
    {"name": "GitHub check", "workflowName": "CI", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://github.example/check"},
    {"context": "ci/circleci: test", "state": "FAILURE", "targetUrl": "https://circleci.example/check"}
  ]
}'

normalized_pull_request="$(
  printf '%s\n' "$pull_request_fixture" \
    | "$script_dir/collect-prs.sh" --normalize-pr mui/example
)"

jq -e '
  .repository == "mui/example"
  and .updateCount == 2
  and .updateRowCount == 3
  and (.updates | length) == 3
  and .updates[0] == {
    dependency: "example",
    from: "^1.0.0",
    to: "^2.0.0"
  }
  and (.failedChecks | map(.url)) == [
    "https://github.example/check",
    "https://circleci.example/check"
  ]
' <<< "$normalized_pull_request" >/dev/null
