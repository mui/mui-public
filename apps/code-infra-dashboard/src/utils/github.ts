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
