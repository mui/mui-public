import { vi, describe, it, expect, afterEach } from 'vitest';
import { getOAuthClient } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubConfiguredDeploy() {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('SESSION_SECRET', 'session-secret');
  vi.stubEnv('IS_PULL_REQUEST', 'false');
}

describe('getOAuthClient', () => {
  it('returns the configured credentials', () => {
    stubConfiguredDeploy();

    expect(getOAuthClient()).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' });
  });

  it('returns null when the client secret is missing', () => {
    stubConfiguredDeploy();
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', undefined);

    expect(getOAuthClient()).toBe(null);
  });

  it('returns null without a session secret to store the token under', () => {
    stubConfiguredDeploy();
    vi.stubEnv('SESSION_SECRET', undefined);

    expect(getOAuthClient()).toBe(null);
  });

  // Preview environments inherit the credentials from the shared environment
  // group, but their origin can't be a registered callback URL.
  it('returns null on a preview deploy even with everything configured', () => {
    stubConfiguredDeploy();
    vi.stubEnv('IS_PULL_REQUEST', 'true');

    expect(getOAuthClient()).toBe(null);
  });
});
