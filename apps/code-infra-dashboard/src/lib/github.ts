import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

let cachedOctokit: Octokit | null = null;
let cachedOctokitIsAuthenticated = false;

export function getOctokit(): Octokit {
  if (cachedOctokit) {
    return cachedOctokit;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    cachedOctokitIsAuthenticated = true;
    cachedOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId: Number(installationId),
      },
    });
  } else if (process.env.GITHUB_TOKEN) {
    cachedOctokitIsAuthenticated = true;
    cachedOctokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  } else {
    console.warn(
      'No GitHub authentication configured. Set GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY/GITHUB_APP_INSTALLATION_ID or GITHUB_TOKEN. Using unauthenticated GitHub API access.',
    );
    cachedOctokit = new Octokit();
  }

  return cachedOctokit;
}

/**
 * Octokit for the paths that write. Reads against a public repository succeed without
 * credentials, so an unconfigured deploy would otherwise get all the way through the
 * checks before failing on the write, and report that as an outage. Fail on the way in
 * instead, where the message names the actual problem.
 */
export function getAuthenticatedOctokit(): Octokit {
  const octokit = getOctokit();

  if (!cachedOctokitIsAuthenticated) {
    throw new Error(
      'No GitHub authentication configured. Set GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY/GITHUB_APP_INSTALLATION_ID or GITHUB_TOKEN.',
    );
  }

  return octokit;
}
