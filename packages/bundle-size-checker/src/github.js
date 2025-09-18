// @ts-check

import { Octokit } from '@octokit/rest';

// Create and export Octokit instance
/** @type {import('@octokit/rest').Octokit} */
export const octokit = new Octokit({
  auth: process.env.DANGER_GITHUB_API_TOKEN,
  userAgent: 'bundle-size-checker',
});
