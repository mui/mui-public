import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_ORIGIN } from '@/constants';
import { GET } from './route';

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
    const response = await GET(timelineRequest('mui/base-ui-charts'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown repository' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
