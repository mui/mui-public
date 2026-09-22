import { refreshToken as exchangeRefreshToken } from '@octokit/oauth-methods';
import { getOAuthClient } from './config';
import type { Session } from './session';

/** Refresh slightly early so a token can't expire mid-flight. */
const REFRESH_SKEW_MS = 60 * 1000;

/**
 * GitHub rotates the refresh token on every use and invalidates the previous one
 * immediately. A page issues many concurrent requests, so two of them refreshing
 * at once would leave the loser's rotation invalidating the winner's token and
 * log the user out at random. This dashboard runs as a single long-lived Node
 * process, so de-duplicating in memory is enough.
 *
 * Keyed by the refresh token itself: callers that arrive with the same token are
 * by definition the same rotation.
 */
const inFlightRefreshes = new Map<string, Promise<Session | null>>();

/** GitHub Apps without token expiry never hand out `expiresAt`. */
export function isTokenExpired(session: Session): boolean {
  if (!session.expiresAt) {
    return false;
  }
  return Date.parse(session.expiresAt) - Date.now() < REFRESH_SKEW_MS;
}

function isRefreshTokenUsable(session: Session): boolean {
  if (!session.refreshTokenExpiresAt) {
    return true;
  }
  return Date.parse(session.refreshTokenExpiresAt) > Date.now();
}

async function exchange(session: Session): Promise<Session | null> {
  const client = getOAuthClient();
  if (!client || !session.refreshToken) {
    return null;
  }

  const { authentication } = await exchangeRefreshToken({
    clientType: 'github-app',
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken: session.refreshToken,
  });

  return {
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    token: authentication.token,
    expiresAt: authentication.expiresAt,
    refreshToken: authentication.refreshToken,
    refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
  };
}

/**
 * Returns a session with a usable token, refreshing first if necessary. Returns
 * null when the user has to sign in again.
 *
 * Callers that get back a different object than they passed in are responsible
 * for persisting it with `writeSession`, or the next request replays a refresh
 * token GitHub has already invalidated.
 */
export async function getRefreshedSession(session: Session): Promise<Session | null> {
  if (!isTokenExpired(session)) {
    return session;
  }

  const { refreshToken } = session;
  if (!refreshToken || !isRefreshTokenUsable(session)) {
    return null;
  }

  let pending = inFlightRefreshes.get(refreshToken);
  if (!pending) {
    pending = exchange(session).finally(() => {
      inFlightRefreshes.delete(refreshToken);
    });
    inFlightRefreshes.set(refreshToken, pending);
  }

  return pending;
}
