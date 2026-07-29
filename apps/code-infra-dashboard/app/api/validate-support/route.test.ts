import { vi, describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const URL = 'https://dashboard.test/api/validate-support';

/** Each test uses its own client address so the shared rate limiter can't leak between them. */
function postAs(clientIp: string, body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID_BODY = { repo: 'test-repo', issueId: 42, supportKey: 'some-key' };

describe('POST /api/validate-support', () => {
  it('rejects a malformed JSON body', async () => {
    const response = await POST(postAs('203.0.113.1', 'not json'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'error', message: 'Invalid JSON body.' });
  });

  it('rejects a body with missing fields', async () => {
    const response = await POST(postAs('203.0.113.2', { repo: 'test-repo' }));

    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe('error');
  });

  it('rejects a repository name that is not a bare repo', async () => {
    const response = await POST(postAs('203.0.113.3', { ...VALID_BODY, repo: 'mui/test-repo' }));

    expect(response.status).toBe(400);
  });

  it('rejects a non-numeric issue id', async () => {
    const response = await POST(postAs('203.0.113.4', { ...VALID_BODY, issueId: 'abc' }));

    expect(response.status).toBe(400);
  });

  it('reports unavailability rather than an invalid key when the store is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('BASTION_SSH_KEY', '');

    const response = await POST(postAs('203.0.113.5', VALID_BODY));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'error',
      message: 'Validation is temporarily unavailable. Please try again later.',
    });

    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rate limits repeated attempts from the same client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('BASTION_SSH_KEY', '');

    const attempts = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      // The limiter counts each attempt, so they have to be made one after the other.
      // eslint-disable-next-line no-await-in-loop
      attempts.push(await POST(postAs('203.0.113.6', VALID_BODY)));
    }

    expect(attempts.slice(0, 10).every((response) => response.status !== 429)).toBe(true);

    const blocked = attempts[10];
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);

    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
