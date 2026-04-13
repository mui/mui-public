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

export type ReactionTarget =
  | { kind: 'issue'; owner: string; repo: string; number: number }
  | { kind: 'issueComment'; owner: string; repo: string; commentId: number }
  | { kind: 'pullRequestReviewComment'; owner: string; repo: string; commentId: number };

const ISSUE_PATH_RE = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/;

/**
 * Parse a GitHub issue, PR, or comment URL into a reaction target.
 * Returns null if the URL is not a recognized GitHub resource.
 */
export function parseReactionUrl(input: string): ReactionTarget | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com') {
    return null;
  }

  const pathMatch = ISSUE_PATH_RE.exec(url.pathname);
  if (!pathMatch) {
    return null;
  }

  const [, owner, repo, numberStr] = pathMatch;

  const issueCommentMatch = /^#issuecomment-(\d+)$/.exec(url.hash);
  if (issueCommentMatch) {
    return { kind: 'issueComment', owner, repo, commentId: Number(issueCommentMatch[1]) };
  }

  const reviewCommentMatch = /^#discussion_r(\d+)$/.exec(url.hash);
  if (reviewCommentMatch) {
    return {
      kind: 'pullRequestReviewComment',
      owner,
      repo,
      commentId: Number(reviewCommentMatch[1]),
    };
  }

  return { kind: 'issue', owner, repo, number: Number(numberStr) };
}
