import { Octokit } from '@octokit/rest';

/**
 * Signed out: straight to GitHub, on the visitor's own anonymous per-IP budget
 * of 60 requests/hour. Routing anonymous traffic through our proxy instead would
 * collapse every visitor onto the server's single IP and make that limit worse.
 */
export const anonymousOctokit: Octokit = new Octokit({});

let proxiedOctokit: Octokit | undefined;

/**
 * Signed in: through our own server, which attaches the user's GitHub token and
 * lifts the limit to 5000 requests/hour.
 *
 * The base URL is absolute because Octokit concatenates it as a plain string and
 * never re-parses it; a relative one would throw if this module were ever
 * evaluated during server rendering.
 */
export function getProxiedOctokit(): Octokit {
  proxiedOctokit ??= new Octokit({ baseUrl: `${window.location.origin}/api/github` });
  return proxiedOctokit;
}

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
