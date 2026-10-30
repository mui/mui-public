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

function loginRequest(returnTo: string): NextRequest {
  const url = new URL('/api/auth/login', DASHBOARD_ORIGIN);
  url.searchParams.set('returnTo', returnTo);
  return new NextRequest(url);
}

describe('GET /api/auth/login', () => {
  it('sends the user to GitHub, remembering where they came from', async () => {
    stubConfiguredDeploy();

    const response = await GET(loginRequest('/repository/acme/widgets/prs'));

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    const stored = new URLSearchParams(response.cookies.get('mui_dashboard_oauth_state')?.value);
    expect(stored.get('state')).toBe(location.searchParams.get('state'));
    expect(stored.get('returnTo')).toBe('/repository/acme/widgets/prs');
  });

  // Browsers silently drop cookies over 4 KB, which would lose the state too and
  // make sign-in from a long URL fail every time.
  it('drops a return path too long to fit in the state cookie', async () => {
    stubConfiguredDeploy();

    const response = await GET(loginRequest(`/query-oss-insight?sql=${'SELECT 1\n'.repeat(400)}`));

    const stateCookie = response.cookies.get('mui_dashboard_oauth_state')?.value ?? '';
    const stored = new URLSearchParams(stateCookie);
    expect(stored.get('state')).toBeTruthy();
    expect(stored.has('returnTo')).toBe(false);
    expect(encodeURIComponent(stateCookie).length).toBeLessThan(4000);
  });

  it('is unavailable without sign-in configured', async () => {
    const response = await GET(loginRequest('/'));

    expect(response.status).toBe(503);
  });
});
