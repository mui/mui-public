import { vi, describe, it, expect, afterEach } from 'vitest';
import type { Session } from './session';
import { getRefreshedSession, isTokenRevoked } from './tokens';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubSignInConfigured() {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('SESSION_SECRET', 'session-secret');
  vi.stubEnv('IS_PULL_REQUEST', 'false');
}

/** Stubs the network GitHub's clients reach it through, counting the calls. */
function stubGitHub(respond: () => Response): { calls: number } {
  const counter = { calls: 0 };
  const fakeFetch: typeof fetch = async () => {
    counter.calls += 1;
    return respond();
  };
  vi.stubGlobal('fetch', fakeFetch);
  return counter;
}

function jsonResponse(body: unknown, status = 200): Response {
  // GitHub always sends `date`; token expiries are computed from it.
  return Response.json(body, { status, headers: { date: new Date().toUTCString() } });
}

const rotatedTokens = {
  access_token: 'new-token',
  expires_in: 28800,
  refresh_token: 'new-refresh-token',
  refresh_token_expires_in: 15811200,
  token_type: 'bearer',
  scope: '',
};

/** Each test needs its own refresh token: rotations are remembered per token. */
function expiredSession(refreshToken: string): Session {
  return {
    login: 'octocat',
    name: null,
    avatarUrl: 'https://avatars.example/octocat',
    token: 'old-token',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe('getRefreshedSession', () => {
  it('returns a session whose token has not expired as is', async () => {
    const session = { ...expiredSession('unused'), expiresAt: undefined };

    await expect(getRefreshedSession(session)).resolves.toBe(session);
  });

  it('rotates an expired token', async () => {
    stubSignInConfigured();
    stubGitHub(() => jsonResponse(rotatedTokens));

    const refreshed = await getRefreshedSession(expiredSession('rotate'));

    expect(refreshed).toMatchObject({
      login: 'octocat',
      token: 'new-token',
      refreshToken: 'new-refresh-token',
    });
  });

  // GitHub invalidates a refresh token the moment it is used. A request that left
  // with the old cookie just before the new one arrived would otherwise replay a
  // dead refresh token and sign the user out.
  it('hands a request still carrying the rotated-out cookie the rotated session', async () => {
    stubSignInConfigured();
    const github = stubGitHub(() => jsonResponse(rotatedTokens));

    const first = await getRefreshedSession(expiredSession('late'));
    const late = await getRefreshedSession(expiredSession('late'));

    expect(late).toEqual(first);
    expect(github.calls).toBe(1);
  });

  it('signs the user out when GitHub refuses the refresh token', async () => {
    stubSignInConfigured();
    // GitHub's token endpoint answers a refusal with 200 and an error body.
    stubGitHub(() => jsonResponse({ error: 'bad_refresh_token', error_description: 'Bad' }));

    await expect(getRefreshedSession(expiredSession('refused'))).resolves.toBe(null);
  });

  // An outage says nothing about the token, so the next attempt must try again
  // rather than be handed a remembered failure.
  it('lets an outage through, and retries on the next attempt', async () => {
    stubSignInConfigured();
    let outage = true;
    const github = stubGitHub(() =>
      outage ? new Response('Bad gateway', { status: 502 }) : jsonResponse(rotatedTokens),
    );

    await expect(getRefreshedSession(expiredSession('outage'))).rejects.toMatchObject({
      status: 502,
    });
    outage = false;
    await expect(getRefreshedSession(expiredSession('outage'))).resolves.toMatchObject({
      token: 'new-token',
    });
    expect(github.calls).toBe(2);
  });
});

describe('isTokenRevoked', () => {
  it('is true when GitHub rejects the token', async () => {
    stubGitHub(() => jsonResponse({ message: 'Bad credentials' }, 401));

    await expect(isTokenRevoked('revoked-token')).resolves.toBe(true);
  });

  it('is false when GitHub accepts the token', async () => {
    stubGitHub(() => jsonResponse({ login: 'octocat' }));

    await expect(isTokenRevoked('live-token')).resolves.toBe(false);
  });
});
