import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { BASE_COOKIE_OPTIONS, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './config';

/**
 * `expiresAt` and the refresh fields are only present when the GitHub App has
 * "Expire user authorization tokens" enabled. Both shapes have to work, because
 * the app backing the login is configured outside this codebase.
 */
const sessionSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  token: z.string(),
  expiresAt: z.string().optional(),
  refreshToken: z.string().optional(),
  refreshTokenExpiresAt: z.string().optional(),
});

export type Session = z.infer<typeof sessionSchema>;

async function openSessionCookie() {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error('SESSION_SECRET is not configured.');
  }

  return getIronSession<{ github: Session }>(await cookies(), {
    cookieName: SESSION_COOKIE,
    password,
    ttl: SESSION_MAX_AGE_SECONDS,
    cookieOptions: { ...BASE_COOKIE_OPTIONS, path: '/' },
  });
}

export async function writeSession(session: Session): Promise<void> {
  const cookie = await openSessionCookie();
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
