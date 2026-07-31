import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

let cachedOctokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (cachedOctokit) {
    return cachedOctokit;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    cachedOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId: Number(installationId),
      },
    });
  } else if (process.env.GITHUB_TOKEN) {
    cachedOctokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  } else {
    console.warn(
      'No GitHub authentication configured. Set GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY/GITHUB_APP_INSTALLATION_ID or GITHUB_TOKEN. Using unauthenticated GitHub API access.',
    );
    cachedOctokit = new Octokit();
  }

  return cachedOctokit;
}
