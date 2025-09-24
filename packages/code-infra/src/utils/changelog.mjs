import { Octokit } from '@octokit/rest';
import { $ } from 'execa';

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
 * @param {Object} opts
 * @param {string} opts.cwd
 * @returns {Promise<string>}
 */
export async function findLatestTaggedVersion(opts) {
  const { stdout } = await $({
    cwd: opts.cwd,
    // First fetch all tags from all remotes to ensure we have the latest tags. Uses -q flag to suppress output.
    // And then find the latest tag matching "v*".
  })`git fetch --tags --all -q && git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
  return stdout.trim();
}

/**
 * @typedef {Object} FetchCommitsOptions
 * @property {string} token
 * @property {string} repo
 * @property {string} lastRelease
 * @property {string} release
 * @property {string} [org="mui"]
 */

/**
 * Fetches commits between two refs (lastRelease..release) including PR details.
 * Throws if the `token` option is not provided.
 *
 * @param {FetchCommitsOptions} param0
 * @returns {Promise<FetchedCommitDetails[]>}
 */
export async function fetchCommitsBetweenRefs({ org = 'mui', ...options }) {
  if (!options.token) {
    throw new Error('Missing "token" option. The token needs `public_repo` permissions.');
  }
  const opts = { ...options, org };

  return await fetchCommitsRest(opts);
}

/**
 * Fetches commits between two refs using GitHub's REST API.
 * It is more reliable than the GraphQL API but requires multiple network calls (1 + n).
 * One to list all commits between the two refs and then one for each commit to get the PR details.
 *
 * @param {FetchCommitsOptions & { org: string }} param0
 *
 * @returns {Promise<FetchedCommitDetails[]>}
 */
async function fetchCommitsRest({ token, repo, lastRelease, release, org }) {
  const octokit = new Octokit({
    auth: token,
  });
  /**
   * @type {Awaited<ReturnType<Octokit['repos']['compareCommits']>>['data']['commits']}
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
