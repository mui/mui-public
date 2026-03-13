import { Octokit } from '@octokit/rest';

console.log(process.env.GITHUB_TOKEN ? 'GitHub token configured' : 'GitHub token not configured');
export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
});
