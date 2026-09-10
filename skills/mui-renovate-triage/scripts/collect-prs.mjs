#!/usr/bin/env node
// Collect open MUI Renovate PRs and normalize their current review signals as JSON.

import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_REPOSITORIES = [
  'mui/base-ui',
  'mui/material-ui',
  'mui/mui-public',
  'mui/mui-x',
  'mui/base-ui-plus',
  'mui/base-ui-mosaic',
  'mui/base-ui-charts',
];
const DEFAULT_AUTHOR_QUERIES = ['app/code-infra-renovate', 'app/renovate'];
const PULL_REQUEST_FIELDS = [
  'number',
  'title',
  'url',
  'body',
  'files',
  'state',
  'headRefName',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'baseRefName',
  'baseRefOid',
  'headRefOid',
  'statusCheckRollup',
  'updatedAt',
];
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const UPDATE_ROW_PATTERN = /^\| \[([^\]]+)\][^|]*\| \[`([^`]+)` → `([^`]+)`\]/;
const RELEASE_NOTE_PATTERN =
  /breaking|migration|minimum (supported )?node|requires? node|dropped? support|no longer|removed|renamed|commonjs|esm.only/i;

class CliUsageError extends Error {}

/** Return the current time in the collector's stable second-precision format. */
function getGeneratedAt() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Wait before retrying an indeterminate GitHub mergeability result. */
async function delay(milliseconds) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Run GitHub CLI and return its standard output. */
async function runGitHub(args) {
  const { stdout } = await execFileAsync('gh', args, { maxBuffer: 100 * 1024 * 1024 });
  return stdout;
}

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
  const updates = updateRows.map((row) => {
    const match = row.match(UPDATE_ROW_PATTERN);
    if (!match) {
      throw new Error(`Could not parse Renovate update row: ${row}`);
    }
    return { dependency: match[1], from: match[2], to: match[3] };
  });
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
    releaseNoteSignals: body.split('\n').filter((line) => RELEASE_NOTE_PATTERN.test(line)),
    checkCount: checks.length,
    failedChecks: checks.filter(isFailedCheck).map(normalizeCheck),
    pendingChecks: checks.filter(isPendingCheck).map(normalizeCheck),
    body,
  };
}

/** Fetch and normalize a PR, retrying while GitHub reports unknown mergeability. */
async function fetchPullRequest(repository, pullRequestNumber) {
  let normalized;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Mergeability retries must run in order so each query can observe GitHub's latest result.
    // eslint-disable-next-line no-await-in-loop
    const response = await runGitHub([
      'pr',
      'view',
      String(pullRequestNumber),
      '--repo',
      repository,
      '--json',
      PULL_REQUEST_FIELDS.join(','),
    ]);
    normalized = normalizePullRequest(repository, JSON.parse(response));
    if (normalized.mergeable !== 'UNKNOWN' || attempt === 3) {
      return normalized;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(attempt * 1_000);
  }
  return normalized;
}

/** Map items with a fixed maximum number of in-flight operations. */
async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      // Each worker claims another job only after its current job finishes.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/** Search one repository for all configured Renovate authors. */
async function searchRepository(repository, authorQueries) {
  const pullRequests = new Map();
  const searchResults = await Promise.all(
    authorQueries.map(async (authorQuery) => {
      const results = [];
      for (let page = 1; ; page += 1) {
        // Search pagination must stay ordered so we can stop when the current page is short.
        // eslint-disable-next-line no-await-in-loop
        const response = await runGitHub([
          'api',
          '-X',
          'GET',
          'search/issues',
          '-f',
          `q=repo:${repository} is:pr is:open author:${authorQuery}`,
          '-f',
          'per_page=100',
          '-f',
          `page=${page}`,
        ]);
        const result = JSON.parse(response);
        results.push(...result.items);
        if (result.items.length < 100) {
          break;
        }
      }
      return results;
    }),
  );
  for (const searchResult of searchResults) {
    for (const pullRequest of searchResult) {
      pullRequests.set(pullRequest.number, pullRequest);
    }
  }
  return [...pullRequests.values()];
}

/** Print command help. */
function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/collect-prs.mjs [owner/repo ...]',
      '       node scripts/collect-prs.mjs --pr <owner/repo> <number>',
      'Collect open PRs authored by code-infra-renovate[bot] or renovate[bot] as JSON.',
      '',
    ].join('\n'),
  );
}

/** Validate a repository name supplied on the command line. */
function validateRepository(repository) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new CliUsageError(`Invalid repository: ${repository} (expected owner/repo)`);
  }
}

/** Run the collector CLI. */
async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        pr: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliUsageError(error.message);
  }

  if (values.help) {
    printHelp();
    return;
  }

  let singlePullRequest;
  let repositories;
  if (values.pr) {
    const [repository, pullRequestNumber] = positionals;
    if (
      positionals.length !== 2 ||
      !REPOSITORY_PATTERN.test(repository) ||
      !/^[0-9]+$/.test(pullRequestNumber)
    ) {
      throw new CliUsageError('Usage: node scripts/collect-prs.mjs --pr <owner/repo> <number>');
    }
    singlePullRequest = { repository, pullRequestNumber };
  } else {
    repositories = positionals.length > 0 ? positionals : DEFAULT_REPOSITORIES;
    repositories.forEach(validateRepository);
  }

  const concurrencyText = process.env.MUI_RENOVATE_CONCURRENCY || '8';
  const concurrency = Number(concurrencyText);
  if (!/^[1-9][0-9]*$/.test(concurrencyText) || !Number.isSafeInteger(concurrency)) {
    throw new CliUsageError('MUI_RENOVATE_CONCURRENCY must be a positive integer.');
  }

  try {
    await execFileAsync('gh', ['auth', 'status']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Required command not found: gh');
    }
    throw new Error('GitHub CLI is not authenticated. Run gh auth login first.');
  }

  if (singlePullRequest) {
    const pullRequest = await fetchPullRequest(
      singlePullRequest.repository,
      singlePullRequest.pullRequestNumber,
    );
    process.stdout.write(
      `${JSON.stringify(
        { generatedAt: getGeneratedAt(), scope: 'single', pullRequests: [pullRequest] },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const authorQueries = process.env.MUI_RENOVATE_AUTHOR_QUERY
    ? [process.env.MUI_RENOVATE_AUTHOR_QUERY]
    : DEFAULT_AUTHOR_QUERIES;
  const searches = await Promise.all(
    repositories.map(async (repository) => ({
      repository,
      pullRequests: await searchRepository(repository, authorQueries),
    })),
  );
  const repositoryResults = searches.map(({ repository, pullRequests }) => ({
    repository,
    openPullRequests: pullRequests.length,
  }));
  const jobs = [];
  for (const { repository, pullRequests: repositoryPullRequests } of searches) {
    jobs.push(...repositoryPullRequests.map((pullRequest) => [repository, pullRequest.number]));
  }

  const pullRequests = await mapConcurrent(jobs, concurrency, ([repository, number]) =>
    fetchPullRequest(repository, number),
  );
  repositoryResults.sort((left, right) => left.repository.localeCompare(right.repository));
  pullRequests.sort(
    (left, right) => left.repository.localeCompare(right.repository) || left.number - right.number,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: getGeneratedAt(),
        authorQueries,
        repositories: repositoryResults,
        pullRequests,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error instanceof CliUsageError ? 2 : 1;
}
