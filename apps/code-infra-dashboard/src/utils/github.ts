import { Octokit } from '@octokit/rest';

// Create a singleton Octokit instance
// In production, you might want to add authentication here
export const octokit: Octokit = new Octokit({});

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
