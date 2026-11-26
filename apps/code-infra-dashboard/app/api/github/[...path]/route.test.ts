import { vi, describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_ORIGIN } from '@/constants';
import { stubUnconfiguredDeploy } from '@/lib/auth/testEnv';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Fails the test if the proxy reaches GitHub: every case here must be refused before that. */
function forbidGitHub() {
  vi.stubGlobal('fetch', async () => {
    throw new Error('The proxy reached GitHub');
  });
}

function proxyRequest(path: string[], headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL(`/api/github/${path.join('/')}`, DASHBOARD_ORIGIN), {
    headers,
  });
  return GET(request, { params: Promise.resolve({ path }) });
}

// The signed-in paths need a session cookie read through Next's request scope, so these cover
// the refusals that come before it.
describe('GET /api/github/[...path]', () => {
  it('refuses requests from other sites', async () => {
    stubUnconfiguredDeploy();
    forbidGitHub();

    const response = await proxyRequest(['user'], { 'sec-fetch-site': 'cross-site' });

    expect(response.status).toBe(403);
  });

  it.each([['..'], ['.']])('refuses a %s path segment', async (segment) => {
    stubUnconfiguredDeploy();
    forbidGitHub();

    const response = await proxyRequest(['repos', segment, 'user']);

    expect(response.status).toBe(400);
  });

  it('answers 401 without a session, in the shape Octokit reads', async () => {
    stubUnconfiguredDeploy();
    forbidGitHub();

    const response = await proxyRequest(['repos', 'mui', 'material-ui']);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Not signed in to GitHub.' });
  });
});
