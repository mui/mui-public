/* eslint-disable no-console -- progress belongs in the CI log. */

// The dashboard's CI-report API: a bearer-token POST of one JSON body, with the OIDC token
// CircleCI mints for the job.

const DEFAULT_API_URL = 'https://frontend-public.mui.com';

/**
 * Posts `body` to the dashboard, authenticated as this CI job, and returns the response text. `what`
 * names the request in the errors it raises.
 */
export async function postToDashboard(
  pathname: string,
  body: unknown,
  what: string,
): Promise<string> {
  const oidcToken = process.env.CIRCLE_OIDC_TOKEN_V2;
  if (!oidcToken) {
    throw new Error(`CIRCLE_OIDC_TOKEN_V2 environment variable is required for ${what}`);
  }

  // The override exists so a pull request can point at its own dashboard preview deployment.
  const url = new URL(pathname, process.env.CI_REPORT_API_URL || DEFAULT_API_URL);
  console.log(`${what} → ${url.href}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${what} failed (${response.status}): ${responseText}`);
  }
  return responseText;
}
