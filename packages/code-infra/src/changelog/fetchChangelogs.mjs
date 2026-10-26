import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import { mapAsync } from 'es-toolkit/array';

import { persistentAuthStrategy } from '../utils/github.mjs';

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const MIN_MERGE_PARENTS = 2;
const AUTHOR_SUFFIX = /\s+\(@[\w-]+\)(?=\s+\(#\d+\)\s*$)/m;

const ThrottledOctokit = Octokit.plugin(throttling, retry);

/**
 * Waits out short rate limits. Longer ones fail with the original error.
 *
 * @param {number} retryAfter - Seconds until the request may be retried
 * @param {unknown} options
 * @param {unknown} octokit
 * @param {number} retryCount
 * @returns {boolean}
 */
function shouldRetryRateLimit(retryAfter, options, octokit, retryCount) {
  return retryAfter <= 60 && retryCount < 3;
}

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
      : new ThrottledOctokit({
          authStrategy: persistentAuthStrategy,
          throttle: {
            onRateLimit: shouldRetryRateLimit,
            onSecondaryRateLimit: shouldRetryRateLimit,
          },
        });

  return fetchCommitsRest({
    octokit,
    repo: opts.repo,
    lastRelease: opts.lastRelease,
    release: opts.release,
    org: opts.org ?? 'mui',
    onProgress: opts.onProgress,
  });
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

  /** @type {Map<string, Promise<'team' | 'contributor'>>} */
  const directAuthors = new Map();

  /** @param {string} login @returns {Promise<'team' | 'contributor'>} */
  async function checkMembership(login) {
    try {
      await octokit.orgs.checkMembershipForUser({ org, username: login });
      return 'team';
    } catch (error) {
      if (error instanceof Error && 'status' in error) {
        if (error.status === HTTP_NOT_FOUND) {
          return 'contributor';
        }
        if (error.status === HTTP_FORBIDDEN) {
          console.warn(`Cannot check membership for @${login}; treating as community.`);
          return 'contributor';
        }
      }
      throw error;
    }
  }

  /**
   * @param {Commits[number]} commit
   * @param {AbortSignal} signal
   * @returns {Promise<FetchedCommitDetails | null>}
   */
  const fetchCommitDetails = async (commit, signal) => {
    // Squash and merge subjects identify PRs; issue references in prose do not.
    const subject = commit.commit.message.split('\n')[0];
    const prMatch =
      subject.match(/\(#(\d+)\)\s*$/) ?? subject.match(/^Merge pull request #(\d+)\b/);
    const isMerge = (commit.parents?.length ?? 0) >= MIN_MERGE_PARENTS;
    if (!prMatch) {
      return isMerge ? null : directCommit(commit);
    }

    const prNumber = Number(prMatch[1]);

    let pr;
    try {
      pr = await octokit.pulls.get({
        owner: org,
        repo,
        pull_number: prNumber,
        headers: { Accept: 'application/vnd.github.text+json' },
        request: { signal },
      });
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === HTTP_NOT_FOUND) {
        return isMerge ? null : directCommit(commit);
      }
      throw error;
    }

    const labels = pr.data.labels.map((label) => label.name);

    /** @type {FetchedCommitDetails} */
    const details = {
      sha: commit.sha,
      message: isMerge ? `${pr.data.title} (#${prNumber})` : commit.commit.message,
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
      prBody: pr.data.body ?? '',
    };

    const isCherryPick = labels.includes('cherry-pick') || labels.includes('backport');
    if (!isCherryPick) {
      return details;
    }
    if (!details.author?.login.endsWith('[bot]')) {
      details.message = details.message.replace(AUTHOR_SUFFIX, '');
      return details;
    }

    // Only structured backport references or an explicit title suffix establish attribution.
    const originalRef = details.prBody.match(
      /(?:cherry[- ]pick(?:ed)?(?: from| of)?|original(?: pull request| pr)?)\s*:?\s*(?:https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/|#)(\d+)/i,
    );
    const originalLogin = details.prTitle.match(/\(@([\w-]+)\)\s*$/)?.[1];
    if (originalRef) {
      const owner = originalRef[1] ?? org;
      const originalRepo = originalRef[2] ?? repo;
      const number = Number(originalRef[3]);
      if (owner !== org || originalRepo !== repo || number !== prNumber) {
        try {
          const original = await octokit.pulls.get({
            owner,
            repo: originalRepo,
            pull_number: number,
            request: { signal },
          });
          if (original.data.user?.login) {
            details.author = {
              login: original.data.user.login,
              association: getAuthorAssociation(original.data.author_association),
            };
          }
        } catch (error) {
          if (!(error instanceof Error && 'status' in error && error.status === HTTP_NOT_FOUND)) {
            throw error;
          }
        }
      }
    }
    if (details.author?.login.endsWith('[bot]') && originalLogin) {
      details.author = { login: originalLogin, association: 'contributor' };
    }

    if (details.author?.login.endsWith('[bot]')) {
      console.warn(
        `Cannot resolve original author for cherry-pick #${prNumber}; retaining @${details.author.login}.`,
      );
    } else {
      details.message = details.message.replace(AUTHOR_SUFFIX, '');
    }
    return details;
  };

  /** @param {Commits[number]} commit @returns {Promise<FetchedCommitDetails>} */
  async function directCommit(commit) {
    const login = commit.author?.login;
    let association = /** @type {'team' | 'contributor'} */ ('contributor');
    if (login === org) {
      association = 'team';
    } else if (login && !login.endsWith('[bot]')) {
      if (!directAuthors.has(login)) {
        directAuthors.set(login, checkMembership(login));
      }
      association = await /** @type {Promise<'team' | 'contributor'>} */ (directAuthors.get(login));
    }
    return {
      sha: commit.sha,
      message: commit.commit.message,
      labels: [],
      prNumber: null,
      html_url: commit.html_url,
      author: login ? { login, association } : null,
      mergedAt: commit.commit.author?.date ?? null,
      createdAt: commit.commit.author?.date ?? null,
      prTitle: '',
      prBody: '',
    };
  }

  // `mapAsync` rejects on the first error but still runs every queued callback.
  // Aborted once it settles, which cancels requests in flight and skips the ones not started yet.
  const controller = new AbortController();

  let fetched = 0;
  try {
    const commits = await mapAsync(
      results,
      async (commit) => {
        if (controller.signal.aborted) {
          return null;
        }
        const details = await fetchCommitDetails(commit, controller.signal);
        if (!controller.signal.aborted) {
          fetched += 1;
          onProgress?.({ phase: 'Fetching pull requests', count: fetched, total: results.length });
        }
        return details;
      },
      { concurrency: 10 },
    );
    return omitMergedChildren(
      results,
      commits.filter((entry) => entry !== null),
    );
  } finally {
    controller.abort();
  }
}

/**
 * A merge PR represents its branch changes once; changes already on the mainline stay visible.
 * @param {Awaited<ReturnType<OctokitType['repos']['compareCommits']>>['data']['commits']} source
 * @param {FetchedCommitDetails[]} commits
 */
function omitMergedChildren(source, commits) {
  const graph = new Map(source.map((commit) => [commit.sha, commit]));
  /** @param {string} sha */
  function ancestors(sha) {
    const seen = new Set();
    const pending = [sha];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || seen.has(current) || !graph.has(current)) {
        continue;
      }
      seen.add(current);
      pending.push(...(graph.get(current)?.parents ?? []).map((parent) => parent.sha));
    }
    return seen;
  }

  const suppressed = new Set();
  for (const commit of commits) {
    const parents = graph.get(commit.sha)?.parents ?? [];
    if (commit.prNumber === null || parents.length < MIN_MERGE_PARENTS) {
      continue;
    }
    const mainline = ancestors(parents[0].sha);
    for (const parent of parents.slice(1)) {
      for (const sha of ancestors(parent.sha)) {
        if (!mainline.has(sha)) {
          suppressed.add(sha);
        }
      }
    }
  }
  return commits.filter((commit) => !suppressed.has(commit.sha));
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
