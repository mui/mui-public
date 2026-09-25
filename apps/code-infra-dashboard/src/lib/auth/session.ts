import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { z } from 'zod/v4';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './config';

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

let cachedKey: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (cachedKey) {
    return cachedKey;
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured.');
  }

  // Hashed rather than decoded so that any sufficiently random string works as
  // the secret, including a Render `generateValue` one, which has no length or
  // alphabet guarantees. A256GCM needs exactly 32 bytes.
  cachedKey = new Uint8Array(createHash('sha256').update(secret).digest());
  return cachedKey;
}

/** Whether a browser login can work at all in this deploy. */
export function isSessionConfigured(): boolean {
  return Boolean(process.env.SESSION_SECRET);
}

export async function writeSession(session: Session): Promise<void> {
  const jwt = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .encrypt(getKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    // Render terminates TLS, but local dev is plain http.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Returns null for anyone who is not signed in, including when the cookie is
 * expired, tampered with, or encrypted under a rotated SESSION_SECRET. All of
 * those mean the same thing to a caller: treat this request as anonymous.
 */
export async function readSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const { payload } = await jwtDecrypt(raw, getKey());
    return sessionSchema.parse(payload);
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: SESSION_COOKIE, path: '/' });
}
