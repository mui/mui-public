/* eslint-disable no-console -- progress belongs in the CI log. */

/**
 * The dashboard's CI-report API, which both benchmark axes talk to.
 *
 * Every call is the same shape — a bearer-token POST of one JSON body — and the token is the OIDC
 * one CircleCI mints for the job. Keeping that in one place is what stops the endpoint host, the
 * environment variable and the error handling from drifting between the two axes, where a
 * divergence would only ever show up in CI, on whichever one nobody edited.
 */

const DEFAULT_API_URL = 'https://frontend-public.mui.com';

/**
 * Posts `body` to the dashboard, authenticated as this CI job, and returns the response text.
 *
 * `what` names the call in both errors it can raise, so a failure says which request failed rather
 * than only that one did.
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
