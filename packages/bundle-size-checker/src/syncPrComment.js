// @ts-check

/**
 * @typedef {Object} SyncPrCommentParams
 * @property {string} repo - Repository in "owner/repo" format
 * @property {number} prNumber - Pull request number
 * @property {string} commitSha - 40-char hex commit SHA
 * @property {string[]} [trackedBundles] - Bundle IDs to track
 * @property {string} [buildUrl] - Build URL for "in progress" link
 * @property {'pending' | 'complete'} status - Comment status
 */

/**
 * Syncs a PR comment via the dashboard API.
 * @param {string} apiUrl - Base URL of the dashboard API
 * @param {SyncPrCommentParams} params - Parameters for the sync request
 * @returns {Promise<void>}
 */
export async function syncPrComment(apiUrl, params) {
  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for PR comment sync');
  }

  const url = new URL('/api/ci-reports/sync-pr-comment', apiUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Sync PR comment API returned ${response.status} ${response.statusText}: ${responseText}`,
    );
  }
}
