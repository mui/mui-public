import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { BASE_COOKIE_OPTIONS, getOAuthClient } from './config';

const SESSION_COOKIE = 'mui_dashboard_session';

/** Session lifetime when the GitHub App's tokens don't expire; otherwise the token's. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Validated on read rather than trusted: a cookie sealed by an earlier deploy can
 * hold a different shape for as long as it lives.
 */
const sessionSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  token: z.string(),
});

export type Session = z.infer<typeof sessionSchema>;

async function openSessionCookie(ttl = SESSION_MAX_AGE_SECONDS) {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error('SESSION_SECRET is not configured.');
  }

  return getIronSession<{ github: Session }>(await cookies(), {
    cookieName: SESSION_COOKIE,
    password,
    ttl,
    cookieOptions: BASE_COOKIE_OPTIONS,
  });
}

/**
 * The cookie is sealed to expire with the token, which is never refreshed: the
 * browser drops the cookie a minute early, and the seal is refused once a minute
 * of clock-skew allowance past the token's expiry has gone too. A copy used in
 * that last minute carries a dead token, which GitHub rejects and the proxy
 * clears. `tokenExpiresAt` is only sent by GitHub Apps with "Expire user
 * authorization tokens" enabled.
 */
export async function writeSession(session: Session, tokenExpiresAt?: string): Promise<void> {
  // At least a second: iron-session reads a ttl of 0 as "never expires".
  const ttl = tokenExpiresAt
    ? Math.max(1, Math.floor((Date.parse(tokenExpiresAt) - Date.now()) / 1000))
    : SESSION_MAX_AGE_SECONDS;

  const cookie = await openSessionCookie(ttl);
  cookie.github = session;
  await cookie.save();
}

/**
 * Returns null for anyone who is not signed in, including when the cookie is
 * expired, tampered with, or sealed under a rotated SESSION_SECRET: iron-session
 * opens all of those as an empty session. Also null wherever sign-in isn't
 * configured, as there is no secret to open the cookie with.
 */
export async function readSession(): Promise<Session | null> {
  if (!getOAuthClient()) {
    return null;
  }
  const cookie = await openSessionCookie();
  const parsed = sessionSchema.safeParse(cookie.github);
  return parsed.success ? parsed.data : null;
}

export async function clearSession(): Promise<void> {
  if (!getOAuthClient()) {
    return;
  }
  const cookie = await openSessionCookie();
  cookie.destroy();
}
