// Shape GitHub's pull-request payload into the fields triage reads.

const UPDATE_ROW_PATTERN = /^\| \[([^\]]+)\].*?\| \[`([^`]+)` → `([^`]+)`\]/;
const RELEASE_NOTE_PATTERN =
  /breaking|migration|minimum (supported )?node|requires? node|dropped? support|no longer|removed|renamed|commonjs|esm.only/i;

/** Normalize one GitHub status check. */
function normalizeCheck(check) {
  return {
    name: check.name ?? check.context ?? 'unnamed check',
    workflow: check.workflowName ?? null,
    status: check.status ?? null,
    conclusion: check.conclusion ?? null,
    state: check.state ?? null,
    url: check.detailsUrl ?? check.targetUrl ?? null,
  };
}

/** Return whether a GitHub status check has failed. */
function isFailedCheck(check) {
  return (
    ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(
      check.conclusion,
    ) || ['FAILURE', 'ERROR'].includes(check.state)
  );
}

/** Return whether a GitHub status check is still pending. */
function isPendingCheck(check) {
  return (
    (check.status != null && check.status !== 'COMPLETED') ||
    ['PENDING', 'EXPECTED'].includes(check.state)
  );
}

/** Normalize GitHub's pull-request response for triage. */
export function normalizePullRequest(repository, pullRequest) {
  const body = pullRequest.body ?? '';
  const updateRows = body
    .split('\n')
    .filter((line) => line.startsWith('| [') && line.includes('renovatebot.com/diffs/'));
  // A row the pattern misses is reported, not fatal: one odd table must not
  // abort the whole fleet snapshot.
  const updates = [];
  const unparsedUpdateRows = [];
  for (const row of updateRows) {
    const match = row.match(UPDATE_ROW_PATTERN);
    if (!match) {
      unparsedUpdateRows.push(row);
      continue;
    }
    updates.push({ dependency: match[1], from: match[2], to: match[3] });
  }
  const checks = pullRequest.statusCheckRollup ?? [];

  return {
    repository,
    number: pullRequest.number ?? null,
    title: pullRequest.title ?? null,
    url: pullRequest.url ?? null,
    updatedAt: pullRequest.updatedAt ?? null,
    state: pullRequest.state ?? null,
    headRefName: pullRequest.headRefName ?? null,
    baseRefName: pullRequest.baseRefName ?? null,
    baseRefOid: pullRequest.baseRefOid ?? null,
    headRefOid: pullRequest.headRefOid ?? null,
    isDraft: pullRequest.isDraft ?? null,
    mergeable: pullRequest.mergeable ?? null,
    mergeStateStatus: pullRequest.mergeStateStatus ?? null,
    reviewDecision: pullRequest.reviewDecision ?? null,
    files: (pullRequest.files ?? []).map((file) => file.path),
    updateCount: new Set(updates.map((update) => update.dependency)).size,
    updateRowCount: updateRows.length,
    updates,
    updateRows,
    unparsedUpdateRows,
    releaseNoteSignals: body.split('\n').filter((line) => RELEASE_NOTE_PATTERN.test(line)),
    checkCount: checks.length,
    ciStatus: getCiStatus(checks),
    failedChecks: checks.filter(isFailedCheck).map(normalizeCheck),
    pendingChecks: checks.filter(isPendingCheck).map(normalizeCheck),
    body,
  };
}

/** Collapse a PR's check rollup into one status for the worklist. */
function getCiStatus(checks) {
  if (checks.length === 0) {
    return 'none';
  }
  if (checks.some(isFailedCheck)) {
    return 'failing';
  }
  if (checks.some(isPendingCheck)) {
    return 'pending';
  }
  return 'passing';
}

/**
 * Return the mechanical blockers to merging a freshly fetched PR.
 *
 * Review state is deliberately not a blocker: a required approval is what the
 * merge step supplies, and `BLOCKED` merge state usually just mirrors it.
 * Only conflicts, drafts, closed PRs and check results block.
 */
export function getMergeBlockers(pullRequest) {
  const blockers = [];
  if (pullRequest.state !== 'OPEN') {
    blockers.push(`PR state is ${pullRequest.state ?? 'unknown'}.`);
  }
  if (pullRequest.isDraft !== false) {
    blockers.push('PR is a draft or draft status is unknown.');
  }
  if (pullRequest.mergeable !== 'MERGEABLE') {
    blockers.push(`Mergeability is ${pullRequest.mergeable ?? 'unknown'}.`);
  }
  if (pullRequest.mergeStateStatus === 'DIRTY') {
    blockers.push('Merge state is DIRTY (conflicts with the base branch).');
  }
  if (pullRequest.checkCount === 0) {
    blockers.push('No CI checks were reported.');
  }
  for (const check of pullRequest.failedChecks) {
    blockers.push(`Failed check: ${check.name}.`);
  }
  for (const check of pullRequest.pendingChecks) {
    blockers.push(`Pending check: ${check.name}.`);
  }
  return blockers;
}
