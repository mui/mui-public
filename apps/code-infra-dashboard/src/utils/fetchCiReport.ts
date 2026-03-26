/**
 * Fetches a CI report JSON from S3 for a given repo and commit SHA.
 * Returns `null` when the report does not exist (S3 returns 403 for missing objects).
 */
export async function fetchCiReport<T>(
  repo: string,
  sha: string,
  reportName: string,
): Promise<T | null> {
  const url = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${repo}/${sha}/${reportName}`;
  const response = await fetch(url);

  if (response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch CI report: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
