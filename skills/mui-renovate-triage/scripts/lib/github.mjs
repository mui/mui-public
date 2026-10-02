// GitHub CLI access: search, fetch and enrich pull requests.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePullRequest } from './normalize.mjs';

const execFileAsync = promisify(execFile);
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

/** Fail early when gh is missing or logged out. */
export async function assertGitHubAuth() {
  try {
    await execFileAsync('gh', ['auth', 'status']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Required command not found: gh');
    }
    throw new Error('GitHub CLI is not authenticated. Run gh auth login first.');
  }
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

/** Fetch and normalize a PR, retrying while GitHub reports unknown mergeability. */
export async function fetchPullRequest(repository, pullRequestNumber) {
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
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(attempt * 1_000);
  }
  normalized.behindBy = await fetchBehindBy(repository, normalized);
  return normalized;
}

/** Number of base-branch commits the PR head lacks; null when GitHub cannot compare. */
async function fetchBehindBy(repository, pullRequest) {
  if (!pullRequest.baseRefName || !pullRequest.headRefOid) {
    return null;
  }
  try {
    const response = await runGitHub([
      'api',
      `repos/${repository}/compare/${pullRequest.baseRefName}...${pullRequest.headRefOid}`,
      '--jq',
      '.behind_by',
    ]);
    const value = Number.parseInt(response, 10);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

/** Tip of a repository's base branch, for judging how stale PR heads are. */
export async function fetchBaseHead(repository, baseRefName) {
  try {
    const response = await runGitHub([
      'api',
      `repos/${repository}/commits/${baseRefName}`,
      '--jq',
      '{sha: .sha, committedAt: .commit.committer.date}',
    ]);
    return { ref: baseRefName, ...JSON.parse(response) };
  } catch {
    return { ref: baseRefName, sha: null, committedAt: null };
  }
}

/** Map items with a fixed maximum number of in-flight operations. */
export async function mapConcurrent(items, concurrency, callback) {
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
export async function searchRepository(repository, authorQueries) {
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
