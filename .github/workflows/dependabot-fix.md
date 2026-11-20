---
description: Fix open Dependabot security alerts in mui-public with one PR per package.
on:
  schedule: daily
  workflow_dispatch:
# What shared/dependabot-fix.md needs; gh-aw requires the importing workflow to grant it.
permissions:
  contents: read
  pull-requests: read
  security-events: read
  # Mints the GitHub OIDC token exchanged for a Claude token (engine.auth below).
  id-token: write
engine:
  id: claude
  # Keyless Workload Identity Federation, the same repository variables the Claude review and
  # triage workflows use.
  auth:
    type: github-oidc
    provider: anthropic
    audience: https://api.anthropic.com
    federation-rule-id: ${{ vars.ANTHROPIC_FEDERATION_RULE_ID }}
    organization-id: ${{ vars.ANTHROPIC_ORGANIZATION_ID }}
    service-account-id: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }}
    workspace-id: ${{ vars.ANTHROPIC_WORKSPACE_ID }}
model: claude-opus-5-5
skills:
  - skills/mui-dependabot-fix
imports:
  - shared/dependabot-fix.md
---

# Dependabot fix

Fix the open Dependabot security alerts in this repository.
