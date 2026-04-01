export type SizeSnapshotEntry = { parsed: number; gzip: number };
export type SizeSnapshot = Record<string, SizeSnapshotEntry>;

export async function fetchSnapshot(repo: string, sha: string): Promise<SizeSnapshot> {
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
