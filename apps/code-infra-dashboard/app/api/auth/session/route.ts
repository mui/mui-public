import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { SessionResponse } from '@/hooks/useSession';
import { getOAuthClient } from '@/lib/auth/config';
import { clearSession, readSession, writeSession } from '@/lib/auth/session';
import { getRefreshedSession, isTokenRevoked } from '@/lib/auth/tokens';

/**
 * The only place that writes or clears the session after sign-in. The API proxy
 * never does: a request rejected by GitHub may have carried a token that a
 * rotation has replaced since, and only this route sees the current cookie.
 *
 * `?verify=1` is for after such a rejection: it additionally asks GitHub whether
 * the current token still works, which stops being true once the user revokes
 * the app before the token expires.
 */
export async function GET(request: NextRequest) {
  if (!getOAuthClient()) {
    return NextResponse.json({ available: false, signedIn: false } satisfies SessionResponse);
  }

  const session = await readSession();
  let current = session && (await getRefreshedSession(session));

  // A token rotated just now is known to be good.
  if (
    current &&
    current === session &&
    request.nextUrl.searchParams.has('verify') &&
    (await isTokenRevoked(current.token))
  ) {
    current = null;
  }

  if (!current) {
    if (session) {
      await clearSession();
    }
    return NextResponse.json({ available: true, signedIn: false } satisfies SessionResponse);
  }

  if (current !== session) {
    await writeSession(current);
  }

  return NextResponse.json({
    available: true,
    signedIn: true,
    login: current.login,
    name: current.name,
    avatarUrl: current.avatarUrl,
  } satisfies SessionResponse);
}
