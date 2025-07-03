import { octokit } from './github.js';

/**
 *
 * @param {string} repo - The name of the repository e.g. 'mui/material-ui'
 * @param {string} sha - The commit SHA
 * @returns {Promise<import('./sizeDiff').SizeSnapshot>} - The size snapshot data
 */
export async function fetchSnapshot(repo, sha) {
  const urlsToTry = [
    `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${repo}/${sha}/size-snapshot.json`,
  ];

  if (repo === 'mui/material-ui') {
    urlsToTry.push(
      `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/master/${sha}/size-snapshot.json`,
    );
  }

  let lastError;
  for (const url of urlsToTry) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url);
      if (!response.ok) {
        lastError = new Error(`Failed to fetch "${url}", HTTP ${response.status}`);
        continue;
      }

      return response.json();
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw new Error(`Failed to fetch snapshot`, { cause: lastError });
}

/**
 * Gets parent commits for a given commit SHA using GitHub API
 * @param {string} repo - Repository name (e.g., 'mui/material-ui')
 * @param {string} commit - The commit SHA to start from
 * @param {number} depth - How many commits to retrieve (including the starting commit)
 * @returns {Promise<string[]>} Array of commit SHAs in chronological order (excluding the starting commit)
 */
async function getParentCommits(repo, commit, depth = 4) {
  try {
    const [owner, repoName] = repo.split('/');

    const { data: commits } = await octokit.repos.listCommits({
      owner,
      repo: repoName,
      sha: commit,
      per_page: depth,
    });

    // Skip the first commit (which is the starting commit) and return the rest
    return commits.slice(1).map((commitDetails) => commitDetails.sha);
  } catch (/** @type {any} */ error) {
    console.warn(`Failed to get parent commits for ${commit}: ${error.message}`);
    return [];
  }
}

/**
 * Attempts to fetch a snapshot with fallback to parent commits
 * @param {string} repo - Repository name
 * @param {string} commit - The commit SHA to start from
 * @param {number} [fallbackDepth=3] - How many parent commits to try as fallback
 * @returns {Promise<{snapshot: import('./sizeDiff').SizeSnapshot | null, actualCommit: string | null}>}
 */
export async function fetchSnapshotWithFallback(repo, commit, fallbackDepth = 3) {
  // Try the original commit first
  try {
    const snapshot = await fetchSnapshot(repo, commit);
    return { snapshot, actualCommit: commit };
  } catch (/** @type {any} */ error) {
    // fallthrough to parent commits if the snapshot for the original commit fails
  }

  // Get parent commits and try each one
  const parentCommits = await getParentCommits(repo, commit, fallbackDepth + 1);

  for (const parentCommit of parentCommits) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await fetchSnapshot(repo, parentCommit);
      return { snapshot, actualCommit: parentCommit };
    } catch {
      // fallthrough to the next parent commit if fetching fails
    }
  }

  return { snapshot: null, actualCommit: null };
}
