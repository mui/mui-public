const DEFAULT_API_URL = 'https://frontend-public.mui.com';

interface SyncPrCommentResult {
  success: boolean;
  skipped?: boolean;
}

/**
 * Syncs a PR comment via the dashboard API.
 */
export async function syncPrComment(repo: string): Promise<SyncPrCommentResult> {
  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error('CIRCLE_OIDC_TOKEN_V2 environment variable is required for PR comment sync');
  }

  const apiUrl = process.env.CI_REPORT_API_URL || DEFAULT_API_URL;
  const url = new URL('/api/ci-reports/sync-pr-comment', apiUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify({ repo }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Sync PR comment API returned ${response.status} ${response.statusText}: ${responseText}`,
    );
  }

  return response.json();
}
