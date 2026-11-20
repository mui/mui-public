---
description: Fix open Dependabot security alerts with one PR per package.
# Reusable only: repositories, mui-public included (dependabot-fix.yml), call the compiled
# dependabot-fix-workflow.lock.yml on their own schedule, and it runs against the calling repository.
on:
  workflow_call:
permissions:
  contents: read
  issues: read
  pull-requests: read
  # Lets GITHUB_TOKEN read Dependabot alerts.
  security-events: read
  # Mints the GitHub OIDC token exchanged for a Claude token (engine.auth below).
  id-token: write
engine:
  id: claude
  # Keyless Workload Identity Federation with the calling repository's variables, the same ones the
  # Claude review and triage workflows use.
  auth:
    type: github-oidc
    provider: anthropic
    audience: https://api.anthropic.com
    federation-rule-id: ${{ vars.ANTHROPIC_FEDERATION_RULE_ID }}
    organization-id: ${{ vars.ANTHROPIC_ORGANIZATION_ID }}
    service-account-id: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }}
    workspace-id: ${{ vars.ANTHROPIC_WORKSPACE_ID }}
model: claude-opus-5-5
# When another repository calls this workflow, its checkout contains neither this prompt nor the
# skill: compile the prompt into the lock file, and install the skill from mui-public. gh-aw doesn't
# accept expressions such as job.workflow_sha in skill refs, so the skill tracks master.
inlined-imports: true
skills:
  - mui/mui-public/skills/mui-dependabot-fix@master
tools:
  github:
    mode: gh-proxy
    toolsets: [default]
network:
  allowed: [defaults, node]
steps:
  - name: Set up pnpm
    uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1
  - name: Set up Node.js
    uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version-file: package.json
      cache: pnpm
  - name: Install dependencies
    run: pnpm install --frozen-lockfile
  - name: Collect open Dependabot alerts
    env:
      GH_TOKEN: ${{ github.token }}
    run: |
      set -euo pipefail
      out=/tmp/gh-aw/agent
      mkdir -p "$out"
      gh api "repos/$GITHUB_REPOSITORY/dependabot/alerts?state=open&per_page=100" --paginate \
        | jq -s 'add // [] | group_by(.dependency.package.name) | map({
            package: .[0].dependency.package.name,
            ecosystem: .[0].dependency.package.ecosystem,
            alerts: map({
              number,
              ghsa: .security_advisory.ghsa_id,
              severity: .security_advisory.severity,
              summary: .security_advisory.summary,
              manifest: .dependency.manifest_path,
              relationship: .dependency.relationship,
              scope: .dependency.scope,
              vulnerable_range: .security_vulnerability.vulnerable_version_range,
              first_patched: .security_vulnerability.first_patched_version.identifier
            })
          })' > "$out/dependabot-alerts.json"
      echo "Packages with open alerts: $(jq length "$out/dependabot-alerts.json")"
  # This workflow's own open PRs: the agent's gh calls only see content from trusted authors, which
  # excludes the App that opens them. Matched by title and label, which the safe outputs below set.
  - name: Collect this workflow's open PRs
    env:
      GH_TOKEN: ${{ github.token }}
    run: |
      set -euo pipefail
      gh pr list --repo "$GITHUB_REPOSITORY" --state open --label dependencies --label security \
          --search 'in:title "[security]"' --limit 100 --json number,title,url,body \
        | jq '
            map(select(.title | startswith("[security] ")) | {
              number,
              url,
              title,
              packages: [.body // "" | splits("\n") | capture("^### (?<p>\\S+)\\s*$").p] | unique
            })
            | { batch_open: any(.[]; .title == "[security] Fix Dependabot alerts"), pull_requests: . }
          ' > /tmp/gh-aw/agent/open-fix-prs.json
      jq -r '"Open fix PRs: \(.pull_requests | length), batch open: \(.batch_open)"' \
        /tmp/gh-aw/agent/open-fix-prs.json
safe-outputs:
  # The jobs that publish the outputs use the Code Infra - Auditor App: PRs opened with GITHUB_TOKEN
  # don't trigger GitHub Actions, and MUI repositories require Actions checks. Its credentials are
  # secrets of a `code-infra-auditor` environment in the repository the workflow runs against,
  # restricted to the default branch, so a workflow pushed to any other branch can't read them.
  environment:
    name: code-infra-auditor
    deployment: false
  github-app:
    client-id: ${{ secrets.CODE_INFRA_AUDITOR_CLIENT_ID }}
    private-key: ${{ secrets.CODE_INFRA_AUDITOR_PRIVATE_KEY }}
  create-pull-request:
    # One batch of non-major fixes plus up to two major-version fixes per run.
    max: 3
    title-prefix: '[security] '
    labels: [dependencies, security]
    draft: true
    # The job of this workflow is to change dependency manifests, which gh-aw protects by default.
    protected-files: allowed
    allowed-files:
      - package.json
      - '**/package.json'
      - pnpm-lock.yaml
      - pnpm-workspace.yaml
  create-issue:
    max: 1
    title-prefix: '[security] '
    labels: [dependencies, security]
    close-older-issues: true
---

# Fix open Dependabot alerts

Follow the `mui-dependabot-fix` skill for this repository (`${{ github.repository }}`).

The open alerts are in `/tmp/gh-aw/agent/dependabot-alerts.json`, grouped by package. Dismissed
alerts aren't included. This workflow's own open pull requests, with the packages each one fixes
and whether a batch is open, are in `/tmp/gh-aw/agent/open-fix-prs.json`; use it for the skill's
in-flight check. Dependencies are installed.

Open pull requests with `create_pull_request`, each from its own branch off the default branch:

- At most one batch pull request with all non-major fixes. When a batch pull request from an
  earlier run is still open, don't open another one: its packages are in flight, and the remaining
  non-major fixes wait for the next run after it merges.
- At most two major-version pull requests, one per fix, most severe first. Fixes left over are
  picked up by the next run.

When at least one package is held back, not fixable, should be dismissed, or left for the next run,
create one issue with `create_issue` titled `Dependabot alerts that need a decision` that lists them
with the evidence from the report. Leave out packages that have a pull request open.

When there are no alerts, or every package is already in flight, call `noop` with a short reason.
