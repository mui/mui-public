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
    const response = await fetch(`https://api.github.com/repos/${repo}/commits?sha=${commit}&per_page=${depth}`);
    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status}`);
    }
    
    const commits = await response.json();
    // Skip the first commit (which is the starting commit) and return the rest
    return commits.slice(1).map(commit => commit.sha);
  } catch (error) {
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
  } catch (error) {
    console.error(`Error fetching snapshot for commit ${commit}: ${error.message}`);
  }
  
  // Get parent commits and try each one
  const parentCommits = await getParentCommits(repo, commit, fallbackDepth + 1);
  
  for (const parentCommit of parentCommits) {
    try {
      const snapshot = await fetchSnapshot(repo, parentCommit);
      console.log(`Found snapshot for parent commit ${parentCommit} (fallback from ${commit})`);
      return { snapshot, actualCommit: parentCommit };
    } catch (error) {
      console.error(`Error fetching snapshot for parent commit ${parentCommit}: ${error.message}`);
    }
  }
  
  return { snapshot: null, actualCommit: null };
}
