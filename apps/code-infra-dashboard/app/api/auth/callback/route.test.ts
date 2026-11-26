import { vi, describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_ORIGIN } from '@/constants';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubConfiguredDeploy() {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('SESSION_SECRET', 'a-session-secret-of-thirty-two-chars');
  vi.stubEnv('DASHBOARD_ORIGIN', DASHBOARD_ORIGIN);
}

/**
 * GitHub sending the user back without a code, as when they cancel on the consent
 * screen: no exchange happens, so only the return path decides where they land.
 */
async function returnFromGitHub(returnTo: string | null): Promise<string | null> {
  const stored = new URLSearchParams({ state: 'a-state' });
  if (returnTo !== null) {
    stored.set('returnTo', returnTo);
  }
  const request = new NextRequest(new URL('/api/auth/callback?state=a-state', DASHBOARD_ORIGIN), {
    headers: { cookie: `mui_dashboard_oauth_state=${encodeURIComponent(stored.toString())}` },
  });
  const response = await GET(request);
  return response.headers.get('location');
}

describe('GET /api/auth/callback', () => {
  const dashboardRoot = new URL('/', DASHBOARD_ORIGIN).href;

  it('returns to the page sign-in started from, keeping its query', async () => {
    stubConfiguredDeploy();

    expect(await returnFromGitHub('/repository/acme/widgets/prs?page=2')).toBe(
      new URL('/repository/acme/widgets/prs?page=2', DASHBOARD_ORIGIN).href,
    );
  });

  it('returns to the dashboard root without a return path', async () => {
    stubConfiguredDeploy();

    expect(await returnFromGitHub(null)).toBe(dashboardRoot);
    expect(await returnFromGitHub('')).toBe(dashboardRoot);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    // The URL parser treats a backslash as a slash in http(s) URLs...
    ['a backslash after the leading slash', '/\\evil.example/'],
    // ...and strips tabs and newlines before parsing.
    ['a tab between the slashes', '/\t/evil.example/'],
    ['a newline between the slashes', '/\n/evil.example/'],
  ])('refuses to leave the dashboard via %s', async (_label, returnTo) => {
    stubConfiguredDeploy();

    expect(await returnFromGitHub(returnTo)).toBe(dashboardRoot);
  });

  // A sign-in started in a second tab replaces the state cookie, so the first tab
  // returns with a state that no longer matches. Clearing the cookie then would make
  // the second tab's sign-in fail as well.
  it('keeps the state cookie for the sign-in it belongs to on a mismatch', async () => {
    stubConfiguredDeploy();
    const stored = new URLSearchParams({ state: 'second-tab-state' });
    const url = new URL('/api/auth/callback', DASHBOARD_ORIGIN);
    url.searchParams.set('code', 'a-code');
    url.searchParams.set('state', 'first-tab-state');
    const request = new NextRequest(url, {
      headers: { cookie: `mui_dashboard_oauth_state=${encodeURIComponent(stored.toString())}` },
    });

    const response = await GET(request);

    expect(response.headers.get('set-cookie')).toBe(null);
  });
});
