import { graphql, GraphqlResponseError } from '@octokit/graphql';
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
 * @typedef {import('./github-gql.mjs').CommitConnection} CommitConnection
 */

/**
 * @param {Object} opts
 * @param {string} opts.cwd
 * @returns {Promise<string>}
 */
export async function findLatestTaggedVersion(opts) {
  const { stdout } = await $({ cwd: opts.cwd })`git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
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
 * It first tries to use the GraphQL API (more efficient) and falls back to the
 * REST api if it fails with server error.
 *
 * @param {FetchCommitsOptions} param0
 * @returns {Promise<FetchedCommitDetails[]>}
 */
export async function fetchCommitsBetweenRefs({ org = 'mui', ...options }) {
  if (!options.token) {
    throw new Error('Missing "token" option. The token needs `public_repo` permissions.');
  }
  const opts = { ...options, org };

  /**
   * @type {FetchedCommitDetails[]}
   */
  try {
    return fetchCommitsGraphql(opts);
  } catch (error) {
    let status = 0;
    if (error instanceof GraphqlResponseError) {
      if (error.headers.status) {
        status = parseInt(error.headers.status, 10);
        // only re-throw for client errors (4xx), for server errors (5xx) we want to fall back to the REST API
        if (status >= 400 && status < 500) {
          throw error;
        }
      }
    }
    console.warn(
      `Failed to fetch commits using the GraphQL API, falling back to the REST API. Status Code: ${status}`,
    );
    return await fetchCommitsRest(opts);
  }
}

/**
 * Fetches commits between two refs using GitHub's GraphQL API over a single network call.
 * Its efficient network-wise but is not as reliable as the REST API (in my findings).
 * So keeping both implementations for the time being.
 *
 * @param {FetchCommitsOptions & {org: string}} param0
 * @returns {Promise<FetchedCommitDetails[]>}
 */
export async function fetchCommitsGraphql({ org, token, repo, lastRelease, release }) {
  const gql = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });
  /**
   * @param {string | null} commitAfter
   * @returns {Promise<{repository: {ref: {compare: {commits: CommitConnection}}}}>}
   */
  async function fetchCommitsPaginated(commitAfter = null) {
    return await gql({
      query: `query GetCommitsBetweenRefs($org: String!, $repo: String!, $baseRef: String!, $headRef: String!, $commitCount: Int!, $commitAfter: String) {
  repository(owner: $org, name: $repo) {
    ref(qualifiedName: $baseRef) {
      compare(headRef: $headRef) {
        commits(first: $commitCount, after: $commitAfter) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            oid
            authoredDate
            message
            author {
              user {
                login
              }
            }
            associatedPullRequests(first: 1) {
              nodes {
                number
                authorAssociation
                author {
                  login
                }
                labels(first: 20) {
                  nodes {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
      org,
      repo,
      commitAfter,
      baseRef: lastRelease,
      headRef: release,
      commitCount: 100,
    });
  }

  let hasNextPage = true;
  /**
   * @type {string | null}
   */
  let commitAfter = null;
  /**
   * @type {import('./github-gql.mjs').CommitNode[]}
   */
  let allCommits = [];
  // fetch all commits (with pagination)
  do {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchCommitsPaginated(commitAfter);
    const commits = data.repository.ref.compare.commits;
    hasNextPage = !!commits.pageInfo.hasNextPage;
    commitAfter = hasNextPage ? commits.pageInfo.endCursor : null;
    allCommits.push(...commits.nodes);
  } while (hasNextPage);

  allCommits = allCommits.filter((commit) => commit.associatedPullRequests.nodes.length > 0);

  return allCommits.map((commit) => {
    const pr = commit.associatedPullRequests.nodes[0];
    const labels = pr.labels.nodes.map((label) => label.name);

    /**
     * @type {FetchedCommitDetails}
     */
    return {
      sha: commit.oid,
      message: commit.message,
      labels,
      prNumber: pr.number,
      author: pr.author.user?.login
        ? {
            login: pr.author.user.login,
            association: getAuthorAssociation(pr.authorAssociation),
          }
        : null,
    };
  });
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
export async function fetchCommitsRest({ token, repo, lastRelease, release, org }) {
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
 * @param {import('./github-gql.mjs').AuthorAssocation} input
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
