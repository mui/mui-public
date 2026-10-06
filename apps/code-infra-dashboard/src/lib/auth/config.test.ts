import { vi, describe, it, expect, afterEach } from 'vitest';
import { DASHBOARD_ORIGIN } from '@/constants';
import { getOAuthClient, isCrossSiteRequest, resolveReturnTo } from './config';

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

describe('isCrossSiteRequest', () => {
  it('lets requests from the dashboard itself through', () => {
    expect(isCrossSiteRequest(new Headers({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
  });

  // A sibling subdomain is "same-site" but still not the dashboard.
  it.each(['cross-site', 'same-site', 'none'])('refuses sec-fetch-site: %s', (fetchSite) => {
    expect(isCrossSiteRequest(new Headers({ 'sec-fetch-site': fetchSite }))).toBe(true);
  });

  it('lets browsers that predate the header through', () => {
    expect(isCrossSiteRequest(new Headers())).toBe(false);
  });
});

describe('resolveReturnTo', () => {
  const dashboardRoot = new URL('/', DASHBOARD_ORIGIN).href;

  it('resolves a path on the dashboard, keeping its query', () => {
    expect(resolveReturnTo('/repository/acme/widgets/prs?page=2').href).toBe(
      new URL('/repository/acme/widgets/prs?page=2', DASHBOARD_ORIGIN).href,
    );
  });

  it('falls back to the dashboard root without a return path', () => {
    expect(resolveReturnTo(null).href).toBe(dashboardRoot);
    expect(resolveReturnTo('').href).toBe(dashboardRoot);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    // The URL parser treats a backslash as a slash in http(s) URLs...
    ['a backslash after the leading slash', '/\\evil.example/'],
    // ...and strips tabs and newlines before parsing.
    ['a tab between the slashes', '/\t/evil.example/'],
    ['a newline between the slashes', '/\n/evil.example/'],
  ])('refuses to leave the dashboard via %s', (_label, requested) => {
    expect(resolveReturnTo(requested).href).toBe(dashboardRoot);
  });
});
