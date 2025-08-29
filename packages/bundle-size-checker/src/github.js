// @ts-check

import { Octokit } from '@octokit/rest';
import { createActionAuth } from '@octokit/auth-action';

// Create and export Octokit instance
/** @type {import('@octokit/rest').Octokit} */
export const octokit = new Octokit({
  authStrategy: process.env.GITHUB_TOKEN ? createActionAuth : undefined,
  auth: process.env.DANGER_GITHUB_API_TOKEN,
  userAgent: 'bundle-size-checker',
});
