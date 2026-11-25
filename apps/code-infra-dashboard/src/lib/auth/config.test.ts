import { vi, describe, it, expect, afterEach } from 'vitest';
import { DASHBOARD_ORIGIN } from '@/constants';
import { getOAuthClient } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubConfiguredDeploy() {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('SESSION_SECRET', 'a-session-secret-of-thirty-two-chars');
  vi.stubEnv('DASHBOARD_ORIGIN', DASHBOARD_ORIGIN);
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

  // iron-session throws on shorter secrets, which would crash every session route.
  it('returns null when the session secret is under 32 characters', () => {
    stubConfiguredDeploy();
    vi.stubEnv('SESSION_SECRET', 'only-thirty-one-characters-long');

    expect(getOAuthClient()).toBe(null);
  });

  // Preview environments inherit the credentials from the shared environment
  // group, but not DASHBOARD_ORIGIN, and their own origin can't be a registered
  // callback URL.
  it('returns null without an explicitly configured origin, as on a preview', () => {
    stubConfiguredDeploy();
    vi.stubEnv('DASHBOARD_ORIGIN', undefined);

    expect(getOAuthClient()).toBe(null);
  });
});
