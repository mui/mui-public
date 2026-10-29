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
  vi.stubEnv('IS_PULL_REQUEST', 'false');
}

/**
 * A login request as a browser on `browserOrigin` sends it. Next's own URL for the
 * request uses its configured hostname rather than the browser's, which only the
 * Host header carries; the URL here deliberately uses the canonical origin to
 * reproduce that.
 */
function loginRequest(browserOrigin: string): NextRequest {
  const url = new URL('/api/auth/login', DASHBOARD_ORIGIN);
  url.searchParams.set('returnTo', '/repository/acme/widgets/prs');
  return new NextRequest(url, { headers: { host: new URL(browserOrigin).host } });
}

describe('GET /api/auth/login', () => {
  it('sends the user to GitHub from the canonical origin', async () => {
    stubConfiguredDeploy();

    const response = await GET(loginRequest(DASHBOARD_ORIGIN));

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(response.cookies.get('mui_dashboard_oauth_state')?.value).toBeTruthy();
  });

  // The callback always runs on the canonical origin, so a state cookie set on
  // any other host would never reach it and sign-in could not complete.
  it('restarts on the canonical origin when reached through another host', async () => {
    stubConfiguredDeploy();

    const response = await GET(loginRequest('https://another-host.example'));

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe(new URL(DASHBOARD_ORIGIN).origin);
    expect(location.pathname).toBe('/api/auth/login');
    expect(location.searchParams.get('returnTo')).toBe('/repository/acme/widgets/prs');
    expect(response.cookies.get('mui_dashboard_oauth_state')).toBe(undefined);
  });

  it('is unavailable without sign-in configured', async () => {
    const response = await GET(loginRequest(DASHBOARD_ORIGIN));

    expect(response.status).toBe(503);
  });
});
