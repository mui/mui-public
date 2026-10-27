import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { BASE_COOKIE_OPTIONS, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './config';

/**
 * `expiresAt` is only present when the GitHub App has "Expire user authorization
 * tokens" enabled. The token is never refreshed: the session simply ends with it.
 */
const sessionSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  token: z.string(),
  expiresAt: z.string().optional(),
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
    cookieOptions: { ...BASE_COOKIE_OPTIONS, path: '/' },
  });
}

/**
 * The cookie is sealed to expire with the token, so nothing downstream checks
 * expiry: the browser drops the cookie a minute early, and the seal itself is
 * refused after that time even if a copy survives.
 */
export async function writeSession(session: Session): Promise<void> {
  // At least a second: iron-session reads a ttl of 0 as "never expires".
  const ttl = session.expiresAt
    ? Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000))
    : SESSION_MAX_AGE_SECONDS;

  const cookie = await openSessionCookie(ttl);
  cookie.github = session;
  await cookie.save();
}

/**
 * Returns null for anyone who is not signed in, including when the cookie is
 * expired, tampered with, or sealed under a rotated SESSION_SECRET: iron-session
 * opens all of those as an empty session.
 */
export async function readSession(): Promise<Session | null> {
  const cookie = await openSessionCookie();
  const parsed = sessionSchema.safeParse(cookie.github);
  return parsed.success ? parsed.data : null;
}

export async function clearSession(): Promise<void> {
  const cookie = await openSessionCookie();
  cookie.destroy();
}
