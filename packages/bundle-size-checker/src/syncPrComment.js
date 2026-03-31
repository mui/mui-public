// @ts-check

const DEFAULT_API_URL = 'https://code-infra-dashboard.onrender.com';

/**
 * Syncs a PR comment via the dashboard API.
 * @param {number} prNumber - Pull request number
 * @param {string} commitSha - 40-char hex commit SHA
 * @param {Record<string, object>} sections - Section-specific parameters
 * @returns {Promise<void>}
 */
export async function syncPrComment(prNumber, commitSha, sections) {
  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for PR comment sync');
  }

  const apiUrl = process.env.CI_REPORT_API_URL || DEFAULT_API_URL;
  const url = new URL('/api/ci-reports/sync-pr-comment', apiUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify({ prNumber, commitSha, sections }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Sync PR comment API returned ${response.status} ${response.statusText}: ${responseText}`,
    );
  }
}
