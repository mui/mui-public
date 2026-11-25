import { vi, describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_ORIGIN } from '@/constants';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

function timelineRequest(repo: string): NextRequest {
  const url = new URL('/api/ci-reports/timeline', DASHBOARD_ORIGIN);
  url.searchParams.set('repo', repo);
  url.searchParams.set('timeline', 'master');
  url.searchParams.set('reportType', 'size-snapshot');
  return new NextRequest(url);
}

describe('GET /api/ci-reports/timeline', () => {
  // The commits it lists are what a private repository's report URLs need, so signed out, a
  // private repository is answered like one that doesn't exist, before the bucket is read.
  it('treats a private repository as unknown when signed out', async () => {
    vi.stubEnv('DASHBOARD_ORIGIN', undefined);
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', undefined);
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', undefined);
    vi.stubEnv('SESSION_SECRET', undefined);

    const response = await GET(timelineRequest('mui/base-ui-charts'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown repository' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
