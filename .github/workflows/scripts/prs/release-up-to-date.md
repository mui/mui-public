# Release branch freshness

The reusable `prs_check-release-up-to-date.yml` workflow publishes the commit status
`Release branch up to date` on each PR's current head commit. PRs without the
`release` label pass. Release PRs pass only when their head contains all commits
from the current base branch. Mergeability alone does not establish this.

Add a caller in each consuming repository:

```yaml
name: Release branch freshness
on:
  pull_request_target:
    types: [opened, reopened, synchronize, labeled, unlabeled, edited, closed]
  push:
    branches: [master]
  workflow_dispatch:
  # Repair missed events and recover after transient API or runner failures.
  schedule:
    - cron: '17,47 * * * *'
permissions: {}
jobs:
  release-freshness:
    permissions:
      contents: read
      pull-requests: read
      statuses: write
    uses: mui/mui-public/.github/workflows/prs_check-release-up-to-date.yml@<full commit SHA> # master
```

Optional workflow inputs `base-branch` and `release-label` default to `master`
and `release`. Use one base branch and label configuration per repository: the
status context is shared across all callers. Match the caller's push branch filter
to `base-branch`. Keep PR events unfiltered so retargeting away from the protected
branch refreshes shared heads.

The workflow checks out only trusted mui-public code, never PR code. One job
serializes all event types in the repository and reconciles every open PR targeting
the configured base branch. There is no API-dependent preparation job or PR matrix.
If GitHub replaces a pending job, the replacement still refreshes the affected open
heads. PR events also refresh their event head and previous head after synchronization.

GitHub requests retry transient failures up to three times. If discovery fails,
the job attempts an error status for every head learned from the event and any
completed response pages, continuing if a status write fails. Comparison errors
produce error statuses too. Current statuses are read in GraphQL batches to avoid a request per head and
republishing unchanged results; if that optional read fails, the computed result is still written.

This is an asynchronous freshness check, not an atomic merge-time guarantee.
A base push or label change can leave a previous success visible until its job
runs. A complete discovery outage cannot identify unknown PR heads, and a failed
status write cannot invalidate an existing success. A failed Actions job alone
does not block merging under this required-status rule. Scheduled runs provide
automatic reconciliation after recovery; maintainers can also rerun a failed job
or dispatch the workflow manually. GitHub may delay scheduled runs. Use GitHub's
native up-to-date branch requirement if every merge must be checked atomically.

Commit statuses are shared by PRs with an identical head SHA. If any open PR
sharing that SHA has the release label, the shared status requires freshness.
Closing or retargeting that release PR refreshes the shared status too.

Merge the shared workflow before enabling callers: like the existing reusable
PR workflows, it loads its script from mui-public's default branch.

After merging a caller, run it manually to initialize existing PRs. In that
repository's master branch protection or ruleset, add `Release branch up to date`
as a required status check. Require this explicit commit status, rather than the
Actions job names: base-push jobs run on master, while the status is posted on
each PR head. Repository administration is required to edit these settings.
Keep the global up-to-date requirement disabled if freshness should apply only
to release PRs. Repeat the caller and protection setup in every adopting repository.
