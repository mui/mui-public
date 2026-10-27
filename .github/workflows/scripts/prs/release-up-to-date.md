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
and `release`. Match the caller's push branch filter to `base-branch`. Keep PR events unfiltered so retargeting away from the protected branch refreshes shared heads.

The workflow checks out only trusted mui-public code, never PR code. PR events select the affected SHA bucket, base pushes select buckets containing
open release PRs, and manual runs initialize all open PRs. Sixteen stable SHA
buckets keep the matrix bounded. Every worker refreshes its entire bucket, so
GitHub replacing an older pending job cannot drop another PR's update. Workers
read current API state and API failures report an error status. Status updates run asynchronously after base pushes.

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
