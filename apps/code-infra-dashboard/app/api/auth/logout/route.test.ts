import { vi, describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_ORIGIN } from '@/constants';
import { stubUnconfiguredDeploy } from '@/lib/auth/testEnv';
import { POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

function logoutRequest(fetchSite?: string): NextRequest {
  return new NextRequest(new URL('/api/auth/logout', DASHBOARD_ORIGIN), {
    method: 'POST',
    headers: fetchSite ? { 'sec-fetch-site': fetchSite } : {},
  });
}

// Without sign-in configured there's no session to end, so only the origin check acts.
describe('POST /api/auth/logout', () => {
  it('signs out a request from the dashboard itself', async () => {
    stubUnconfiguredDeploy();

    const response = await POST(logoutRequest('same-origin'));

    expect(response.status).toBe(200);
  });

  // A sibling subdomain is "same-site" but still not the dashboard.
  it.each(['cross-site', 'same-site', 'none'])('refuses sec-fetch-site: %s', async (fetchSite) => {
    stubUnconfiguredDeploy();

    const response = await POST(logoutRequest(fetchSite));

    expect(response.status).toBe(403);
  });

  it('lets browsers that predate the header through', async () => {
    stubUnconfiguredDeploy();

    const response = await POST(logoutRequest());

    expect(response.status).toBe(200);
  });
});
