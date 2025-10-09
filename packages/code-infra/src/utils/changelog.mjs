import { Octokit } from '@octokit/rest';
import { $ } from 'execa';

import { persistentAuthStrategy } from './github.mjs';

/**
 * @typedef {import('@octokit/rest').Octokit} OctokitType
 */

/**
 * @typedef {'team' | 'first_timer' | 'contributor'} AuthorAssociation
 */

/**
 * @typedef {Object} FetchedCommitDetails
 * @property {string} sha
 * @property {string} message
 * @property {string[]} labels
 * @property {number} prNumber
 * @property {{login: string; association: AuthorAssociation} | null} author
 */

/**
 * @typedef {Object} FetchCommitsOptions
 * @property {string} repo
 * @property {string} lastRelease
 * @property {string} release
 * @property {string} [org='mui'] - GitHub organization name, defaults to 'mui'
 */

/**
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {boolean} [opts.fetchAll=true] Whether to fetch all tags from all remotes before finding the latest tag.
 * @returns {Promise<string>}
 */
export async function findLatestTaggedVersion(opts) {
  const $$ = $({ cwd: opts.cwd });
  const fetchAll = opts.fetchAll ?? true;
  if (fetchAll) {
    // Fetch all tags from all remotes to ensure we have the latest tags.
    await $$`git fetch --tags --all`;
  }
  const { stdout } = await $$`git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
  return stdout.trim();
}

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

  return fetchCommitsRest({
    octokit,
    repo: opts.repo,
    lastRelease: opts.lastRelease,
    release: opts.release,
    org: opts.org ?? 'mui',
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
async function fetchCommitsRest({ octokit, repo, lastRelease, release, org = 'mui' }) {
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
  }

  const promises = results.map(async (commit) => {
    const prMatch = commit.commit.message.match(/#(\d+)/);
    if (prMatch === null) {
      return null;
    }

    const prNumber = parseInt(prMatch[1], 10);

    const pr = await octokit.pulls.get({
      owner: org,
      repo,
      pull_number: prNumber,
      headers: {
        Accept: 'application/vnd.github.text+json',
      },
    });

    const labels = pr.data.labels.map((label) => label.name);

    return /** @type {FetchedCommitDetails} */ ({
      sha: commit.sha,
      message: commit.commit.message,
      labels,
      prNumber,
      author: pr.data.user?.login
        ? {
            login: pr.data.user.login,
            association: getAuthorAssociation(pr.data.author_association),
          }
        : null,
    });
  });

  return (await Promise.all(promises)).filter((entry) => entry !== null);
}

/**
 *
 * @param {import('@octokit/rest').RestEndpointMethodTypes["pulls"]["get"]["response"]["data"]["author_association"]} input
 * @returns {AuthorAssociation}
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
