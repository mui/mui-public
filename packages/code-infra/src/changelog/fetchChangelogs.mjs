import { Octokit } from '@octokit/rest';
import { mapAsync } from 'es-toolkit/array';
import { retry } from 'es-toolkit/function';

import { persistentAuthStrategy } from '../utils/github.mjs';

/**
 * @typedef {import('@octokit/rest').Octokit} OctokitType
 */

/**
 * @typedef {import('./types').FetchedCommitDetails} FetchedCommitDetails
 */

/**
 * @typedef {Object} FetchCommitsOptions
 * @property {string} repo
 * @property {string} lastRelease
 * @property {string} release
 * @property {string} [org='mui'] - GitHub organization name, defaults to 'mui'
 * @property {(progress: { phase: string; count: number; total: number }) => void} [onProgress] - Called as commits are listed and their pull request details are fetched
 */

/**
 * Fetches commits between two refs (lastRelease..release) including PR details.
 * Automatically handles GitHub OAuth authentication if none provided.
 *
 * @param {FetchCommitsOptions & {octokit?: OctokitType}} opts
 * @returns {Promise<FetchedCommitDetails[]>}
 */
export async function fetchCommitsBetweenRefs(opts) {
  const octokit =
    'octokit' in opts && opts.octokit
      ? opts.octokit
      : new Octokit({ authStrategy: persistentAuthStrategy });

  try {
    return await fetchCommitsRest({
      octokit,
      repo: opts.repo,
      lastRelease: opts.lastRelease,
      release: opts.release,
      org: opts.org ?? 'mui',
      onProgress: opts.onProgress,
    });
  } catch (error) {
    const retryAt = getRateLimitRetryTime(error);
    if (retryAt) {
      const minutes = Math.ceil((retryAt.getTime() - Date.now()) / 60_000);
      throw new Error(
        `GitHub API rate limit exceeded. Try again after ${retryAt.toLocaleTimeString()} (in about ${minutes} minute${minutes === 1 ? '' : 's'}).`,
      );
    }
    throw error;
  }
}

/**
 * Fetches commits between two refs using GitHub's REST API.
 * It is more reliable than the GraphQL API but requires multiple network calls (1 + n).
 * One to list all commits between the two refs and then one for each commit to get the PR details.
 *
 * @param {FetchCommitsOptions & { octokit: OctokitType}} param0
 *
 * @returns {Promise<FetchedCommitDetails[]>}
 */
async function fetchCommitsRest({ octokit, repo, lastRelease, release, org = 'mui', onProgress }) {
  /**
   * @typedef {Awaited<ReturnType<Octokit['repos']['compareCommits']>>['data']['commits']} Commits
   */
  /**
   * @type {Commits}
   */
  const results = [];
  /**
   * @type {any}
   */
  const timeline = octokit.paginate.iterator(
    octokit.repos.compareCommitsWithBasehead.endpoint.merge({
      owner: org,
      repo,
      basehead: `${lastRelease}...${release}`,
    }),
  );
  for await (const response of timeline) {
    results.push(...response.data.commits);
    onProgress?.({
      phase: 'Listing commits',
      count: results.length,
      total: response.data.total_commits,
    });
  }

  // Aborted once the batch settles, so a failure stops the remaining requests.
  const controller = new AbortController();
  const { signal } = controller;

  /**
   * @param {Commits[number]} commit
   * @returns {Promise<FetchedCommitDetails | null>}
   */
  const fetchCommitDetails = async (commit) => {
    const matches = [...commit.commit.message.matchAll(/#(\d+)/g)];
    // The PR number is always the last match.
    // Sometimes the PR titles include an issue number like this:
    // [tag] PR title (#00001) (#00002)
    const prMatch = matches.at(-1);
    if (!prMatch) {
      return null;
    }

    const prNumber = parseInt(prMatch[1], 10);

    const pr = await retry(
      () =>
        octokit.pulls.get({
          owner: org,
          repo,
          pull_number: prNumber,
          headers: {
            Accept: 'application/vnd.github.text+json',
          },
          request: { signal },
        }),
      {
        retries: 3,
        delay: (attempt) => 1000 * 2 ** attempt,
        shouldRetry: isServerError,
        signal,
      },
    );

    const labels = pr.data.labels.map((label) => label.name);

    return /** @type {FetchedCommitDetails} */ ({
      sha: commit.sha,
      message: commit.commit.message,
      labels,
      prNumber,
      html_url: pr.data.html_url,
      mergedAt: pr.data.merged_at,
      createdAt: pr.data.created_at,
      author: pr.data.user?.login
        ? {
            login: pr.data.user.login,
            association: getAuthorAssociation(pr.data.author_association),
          }
        : null,
      prTitle: pr.data.title,
      prBody: pr.data.body,
    });
  };

  let fetched = 0;
  const commits = await mapAsync(
    results,
    async (commit) => {
      if (signal.aborted) {
        return null;
      }
      const details = await fetchCommitDetails(commit);
      if (!signal.aborted) {
        fetched += 1;
        onProgress?.({ phase: 'Fetching pull requests', count: fetched, total: results.length });
      }
      return details;
    },
    { concurrency: 10 },
  ).finally(() => controller.abort());

  return commits.filter((entry) => entry !== null);
}

/**
 * Returns when a rate-limited request may be retried, or `null` for other errors.
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit
 *
 * @param {unknown} error
 * @returns {Date | null}
 */
function getRateLimitRetryTime(error) {
  const { status, response, message } = /** @type {any} */ (error) ?? {};
  if (status !== 403 && status !== 429) {
    return null;
  }
  const headers = response?.headers ?? {};
  const now = Date.now();
  let retryTime;
  if (headers['retry-after']) {
    retryTime = now + Number(headers['retry-after']) * 1000;
  } else if (headers['x-ratelimit-remaining'] === '0' && headers['x-ratelimit-reset']) {
    retryTime = Number(headers['x-ratelimit-reset']) * 1000;
  } else if (/rate limit/i.test(message ?? '')) {
    retryTime = now;
  } else {
    return null;
  }
  return new Date(Math.max(retryTime, now + 60_000));
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isServerError(error) {
  return /** @type {any} */ (error)?.status >= 500;
}

/**
 *
 * @param {import('@octokit/rest').RestEndpointMethodTypes["pulls"]["get"]["response"]["data"]["author_association"]} input
 * @returns {Exclude<import('./types').FetchedCommitDetails["author"], null>["association"]}
 */
function getAuthorAssociation(input) {
  switch (input) {
    case 'OWNER':
    case 'MEMBER':
      return 'team';
    case 'MANNEQUIN':
    case 'NONE':
    case 'FIRST_TIMER':
    case 'FIRST_TIME_CONTRIBUTOR':
      return 'first_timer';
    default:
      return 'contributor';
  }
}
