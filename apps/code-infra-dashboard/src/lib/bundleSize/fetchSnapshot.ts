export type SizeSnapshotEntry = { parsed: number; gzip: number };
export type SizeSnapshot = Record<string, SizeSnapshotEntry>;

export async function fetchSnapshot(repo: string, sha: string): Promise<SizeSnapshot> {
  const url = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${repo}/${sha}/size-snapshot.json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch "${url}", HTTP ${response.status}`);
  }

  return response.json();
}
