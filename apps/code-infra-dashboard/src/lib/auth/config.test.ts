import { describe, it, expect } from 'vitest';
import { getOAuthClient, isPreviewDeploy } from './config';

/**
 * Sets environment variables for the duration of `run`, restoring whatever was
 * there before -- including variables that were previously unset.
 */
function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const CREDENTIALS = {
  GITHUB_OAUTH_CLIENT_ID: 'client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'client-secret',
};

describe('isPreviewDeploy', () => {
  it('is true only for the string Render actually sets', () => {
    withEnv({ IS_PULL_REQUEST: 'true' }, () => {
      expect(isPreviewDeploy()).toBe(true);
    });
  });

  it('is false on a normal deploy', () => {
    withEnv({ IS_PULL_REQUEST: 'false' }, () => {
      expect(isPreviewDeploy()).toBe(false);
    });
    withEnv({ IS_PULL_REQUEST: undefined }, () => {
      expect(isPreviewDeploy()).toBe(false);
    });
  });
});

describe('getOAuthClient', () => {
  it('returns the configured credentials', () => {
    withEnv({ ...CREDENTIALS, IS_PULL_REQUEST: undefined }, () => {
      expect(getOAuthClient()).toEqual({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      });
    });
  });

  it('returns null when only one half is configured', () => {
    withEnv(
      {
        GITHUB_OAUTH_CLIENT_ID: 'client-id',
        GITHUB_OAUTH_CLIENT_SECRET: undefined,
        IS_PULL_REQUEST: undefined,
      },
      () => {
        expect(getOAuthClient()).toBe(null);
      },
    );
  });

  // Preview environments inherit the credentials from the shared environment
  // group, but their origin can't be a registered callback URL.
  it('returns null on a preview deploy even with credentials present', () => {
    withEnv({ ...CREDENTIALS, IS_PULL_REQUEST: 'true' }, () => {
      expect(getOAuthClient()).toBe(null);
    });
  });
});
