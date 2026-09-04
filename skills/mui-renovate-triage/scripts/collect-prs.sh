#!/usr/bin/env bash
# Collect open MUI Renovate PRs and normalize their current review signals as JSON.
# Usage: collect-prs.sh [owner/repo ...]
set -euo pipefail

normalize_pull_request() {
  local repository="$1"

  jq --arg repository "$repository" '
    def check_name: (.name // .context // "unnamed check");
    def failed:
      .conclusion == "FAILURE"
      or .conclusion == "CANCELLED"
      or .conclusion == "TIMED_OUT"
      or .conclusion == "ACTION_REQUIRED"
      or .conclusion == "STARTUP_FAILURE"
      or .state == "FAILURE"
      or .state == "ERROR";
    def pending:
      (.status != null and .status != "COMPLETED")
      or .state == "PENDING"
      or .state == "EXPECTED";
    def normalized_check:
      {
        name: check_name,
        workflow: .workflowName,
        status,
        conclusion,
        state,
        url: (.detailsUrl // .targetUrl)
      };
    def normalized_update:
      capture(
        "^\\| \\[(?<dependency>[^]]+)\\][^|]*\\| \\[`(?<from>[^`]+)` → `(?<to>[^`]+)`\\]"
      );

    (.statusCheckRollup // []) as $checks
    | [
        .body // ""
        | split("\n")[]
        | select(startswith("| [") and contains("renovatebot.com/diffs/"))
      ] as $update_rows
    | ($update_rows | map(normalized_update)) as $updates
    | {
        repository: $repository,
        number,
        title,
        url,
        updatedAt,
        baseRefName,
        baseRefOid,
        headRefOid,
        isDraft,
        mergeable,
        mergeStateStatus,
        reviewDecision,
        files: [.files[].path],
        updateCount: ($updates | map(.dependency) | unique | length),
        updateRowCount: ($update_rows | length),
        updates: $updates,
        updateRows: $update_rows,
        releaseNoteSignals: [
          (
            .body // ""
            | split("\n")[]
            | select(
                test(
                  "breaking|migration|minimum (supported )?node|requires? node|dropped? support|no longer|removed|renamed|commonjs|esm.only";
                  "i"
                )
              )
          )
        ],
        checkCount: ($checks | length),
        failedChecks: [$checks[] | select(failed) | normalized_check],
        pendingChecks: [$checks[] | select(pending) | normalized_check],
        body
      }
  '
}

fetch_pull_request() {
  local repository="$1"
  local pull_request_number="$2"
  local output_file="$3"
  local attempt

  for attempt in 1 2 3; do
    gh pr view "$pull_request_number" --repo "$repository" \
      --json number,title,url,body,files,isDraft,mergeable,mergeStateStatus,reviewDecision,baseRefName,baseRefOid,headRefOid,statusCheckRollup,updatedAt \
      | normalize_pull_request "$repository" > "$output_file"

    if [[ "$(jq -r '.mergeable' "$output_file")" != "UNKNOWN" ]]; then
      break
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep "$attempt"
    fi
  done
}

if [[ "${1:-}" == "--normalize-pr" ]]; then
  [[ "$#" -eq 2 ]] || {
    printf 'internal usage: %s --normalize-pr <owner/repo>\n' "$0" >&2
    exit 2
  }
  command -v jq >/dev/null || {
    printf 'Required command not found: jq\n' >&2
    exit 1
  }
  normalize_pull_request "$2"
  exit
fi

if [[ "${1:-}" == "--fetch-pr" ]]; then
  [[ "$#" -eq 4 ]] || {
    printf 'internal usage: %s --fetch-pr <owner/repo> <number> <output-file>\n' "$0" >&2
    exit 2
  }
  fetch_pull_request "$2" "$3" "$4"
  exit
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf 'Usage: %s [owner/repo ...]\n' "$0"
  printf 'Collect open PRs authored by code-infra-renovate[bot] as JSON.\n'
  exit
fi

for required_command in gh jq; do
  command -v "$required_command" >/dev/null || {
    printf 'Required command not found: %s\n' "$required_command" >&2
    exit 1
  }
done

gh auth status >/dev/null 2>&1 || {
  printf 'GitHub CLI is not authenticated. Run gh auth login first.\n' >&2
  exit 1
}

author_query="${MUI_RENOVATE_AUTHOR_QUERY:-app/code-infra-renovate}"
concurrency="${MUI_RENOVATE_CONCURRENCY:-8}"
[[ "$concurrency" =~ ^[1-9][0-9]*$ ]] || {
  printf 'MUI_RENOVATE_CONCURRENCY must be a positive integer.\n' >&2
  exit 2
}

if [[ "$#" -gt 0 ]]; then
  repositories=("$@")
else
  repositories=(
    mui/base-ui
    mui/material-ui
    mui/mui-public
    mui/mui-x
  )
fi

task_tmp_dir="$(mktemp -d -t mui-renovate-triage.XXXXXX)"
cleanup() {
  if [[ -d "$task_tmp_dir" ]]; then
    rm -r -- "$task_tmp_dir"
  fi
}
trap cleanup EXIT

jobs_file="$task_tmp_dir/jobs.tsv"
: > "$jobs_file"

repository_index=0
for repository in "${repositories[@]}"; do
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
    printf 'Invalid repository: %s (expected owner/repo)\n' "$repository" >&2
    exit 2
  }

  search_result="$(
    gh api -X GET search/issues \
      -f q="repo:$repository is:pr is:open author:$author_query" \
      -f per_page=100
  )"
  open_count="$(jq -r '.total_count' <<< "$search_result")"
  if (( open_count > 100 )); then
    printf '%s has %s matching PRs; the collector currently supports at most 100 per repository.\n' \
      "$repository" "$open_count" >&2
    exit 1
  fi

  jq --arg repository "$repository" \
    '{repository: $repository, openPullRequests: .total_count}' \
    <<< "$search_result" > "$task_tmp_dir/repository-$repository_index.json"

  while IFS= read -r pull_request_number; do
    [[ -n "$pull_request_number" ]] || continue
    output_file="$task_tmp_dir/pull-$repository_index-$pull_request_number.json"
    printf '%s\t%s\t%s\n' "$repository" "$pull_request_number" "$output_file" >> "$jobs_file"
  done < <(jq -r '.items[].number' <<< "$search_result")

  repository_index=$((repository_index + 1))
done

if [[ -s "$jobs_file" ]]; then
  while IFS=$'\t' read -r repository pull_request_number output_file; do
    printf '%s\0%s\0%s\0' "$repository" "$pull_request_number" "$output_file"
  done < "$jobs_file" \
    | xargs -0 -n 3 -P "$concurrency" "$0" --fetch-pr
fi

jq -s 'sort_by(.repository)' "$task_tmp_dir"/repository-*.json > "$task_tmp_dir/repositories.json"

pull_request_files=("$task_tmp_dir"/pull-*.json)
if [[ -e "${pull_request_files[0]}" ]]; then
  jq -s 'sort_by(.repository, .number)' "${pull_request_files[@]}" > "$task_tmp_dir/pull-requests.json"
else
  printf '[]\n' > "$task_tmp_dir/pull-requests.json"
fi

generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
jq -n \
  --arg generatedAt "$generated_at" \
  --arg authorQuery "$author_query" \
  --slurpfile repositories "$task_tmp_dir/repositories.json" \
  --slurpfile pullRequests "$task_tmp_dir/pull-requests.json" \
  '{
    generatedAt: $generatedAt,
    authorQuery: $authorQuery,
    repositories: $repositories[0],
    pullRequests: $pullRequests[0]
  }'
