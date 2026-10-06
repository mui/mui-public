import { Octokit } from '@octokit/rest';
import { SESSION_QUERY_KEY, fetchSession } from '../hooks/useSession';
import { queryClient } from './queryClient';

/**
 * Signed out: straight to GitHub, on the visitor's own anonymous per-IP budget
 * of 60 requests/hour. Routing anonymous traffic through our proxy instead would
 * collapse every visitor onto the server's single IP and make that limit worse.
 */
export const anonymousOctokit: Octokit = new Octokit({});

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_PROXY_PATH = '/api/github';

/**
 * Re-reads the session through the app's query cache: the session endpoint
 * refreshes an expired token, and every component sees the outcome — including
 * that the visitor is now signed out, so they fall back to anonymous requests.
 * Requests that find the token rejected at the same time share one fetch.
 */
async function refreshSession(): Promise<void> {
  await queryClient.fetchQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 0,
  });
}

/**
 * Redirects every request into the proxy at the transport level rather than via
 * `baseUrl`: Octokit's pagination follows the absolute api.github.com URLs in
 * GitHub's `Link` header verbatim, and those would bypass a `baseUrl`.
 *
 * The proxy refuses an expired token instead of refreshing it, so a 401 gets one
 * retry after the session endpoint has rotated the token.
 */
async function fetchThroughProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === GITHUB_API_ORIGIN) {
    url.protocol = window.location.protocol;
    url.host = window.location.host;
    url.pathname = `${GITHUB_PROXY_PATH}${url.pathname}`;
  }

  const response = await fetch(url, init);
  if (response.status !== 401) {
    return response;
  }

  try {
    await refreshSession();
  } catch {
    // The session couldn't be read either; the original rejection stands.
    return response;
  }
  return fetch(url, init);
}

/**
 * Signed in: through our own server, which attaches the user's GitHub token and
 * lifts the limit to 5000 requests/hour.
 */
export const proxiedOctokit: Octokit = new Octokit({ request: { fetch: fetchThroughProxy } });

// Helper to parse repo string "org/repo" into owner and repo
export function parseRepo(input: string): { owner: string; repo: string } {
  const [owner, repo] = input.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${input}. Expected format: "owner/repo"`);
  }
  return { owner, repo };
}

export interface IssueReactionTarget {
  owner: string;
  repo: string;
  number: number;
}

const ISSUE_PATH_RE = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/;

/**
 * Parse a GitHub issue or pull request URL.
 * Returns null if the URL is not a recognized issue/PR resource (comment URLs are rejected).
 */
export function parseIssueUrl(input: string): IssueReactionTarget | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com' || url.hash) {
    return null;
  }

  const pathMatch = ISSUE_PATH_RE.exec(url.pathname);
  if (!pathMatch) {
    return null;
  }

  const [, owner, repo, numberStr] = pathMatch;
  return { owner, repo, number: Number(numberStr) };
}
