import { refreshToken as exchangeRefreshToken } from '@octokit/oauth-methods';
import { Octokit } from '@octokit/rest';
import { getOAuthClient } from './config';
import type { Session } from './session';

/** Refresh slightly early so a token can't expire mid-flight. */
const REFRESH_SKEW_MS = 60 * 1000;

/**
 * GitHub rotates the refresh token on every use and invalidates the previous one,
 * and the previous access token, immediately. Any request that still carries the
 * old cookie -- concurrent with the rotation, or sent just before the new cookie
 * reached the browser -- would replay a dead refresh token and sign the user out.
 * So each rotation's outcome is shared with everyone presenting the same refresh
 * token, while it runs and for a grace period after. This dashboard runs as a
 * single long-lived Node process, so remembering them in memory is enough.
 */
const rotations = new Map<string, Promise<Session | null>>();

/** Long enough for every request sent with the old cookie to have arrived. */
const ROTATION_GRACE_MS = 60 * 1000;

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

async function exchange(session: Session, refreshToken: string): Promise<Session | null> {
  const client = getOAuthClient();
  if (!client) {
    return null;
  }

  try {
    const { authentication } = await exchangeRefreshToken({
      clientType: 'github-app',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken,
    });

    return {
      ...session,
      token: authentication.token,
      expiresAt: authentication.expiresAt,
      refreshToken: authentication.refreshToken,
      refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
    };
  } catch (error) {
    // GitHub refuses a revoked or already-rotated refresh token with an OAuth
    // error body, which the client raises as a 400; the user has to sign in
    // again. An outage or network error says nothing about the token, so it must
    // not end the session and throw away a refresh token that may still work.
    if (error instanceof Error && 'status' in error && error.status === 400) {
      console.error('GitHub sign-in: GitHub refused the refresh token.', error);
      return null;
    }
    throw error;
  }
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

  let pending = rotations.get(refreshToken);
  if (!pending) {
    pending = exchange(session, refreshToken);
    rotations.set(refreshToken, pending);
    // A failure is forgotten at once: an outage says nothing about the token, so
    // the next attempt has to reach GitHub again rather than inherit the error.
    pending.then(
      () => setTimeout(() => rotations.delete(refreshToken), ROTATION_GRACE_MS),
      () => rotations.delete(refreshToken),
    );
  }

  return pending;
}

/**
 * Asks GitHub whether it still accepts a token whose expiry hasn't passed, which
 * stops being the case once the user revokes the app. Other failures propagate:
 * an outage says nothing about the token.
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  try {
    await new Octokit({ auth: token }).rest.users.getAuthenticated();
    return false;
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 401) {
      return true;
    }
    throw error;
  }
}
