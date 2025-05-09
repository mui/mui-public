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
