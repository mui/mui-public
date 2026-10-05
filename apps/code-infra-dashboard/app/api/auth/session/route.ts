import { NextResponse } from 'next/server';
import type { SessionResponse } from '@/hooks/useSession';
import { getOAuthClient } from '@/lib/auth/config';
import { clearSession, readSession, writeSession } from '@/lib/auth/session';
import { getRefreshedSession } from '@/lib/auth/tokens';

/**
 * The only place that refreshes an expired GitHub token. The API proxy never
 * does, so it never writes cookies; when it rejects an expired token the browser
 * calls this once and retries.
 */
export async function GET() {
  if (!getOAuthClient()) {
    return NextResponse.json({ available: false, signedIn: false } satisfies SessionResponse);
  }

  const session = await readSession();
  const refreshed = session && (await getRefreshedSession(session));

  if (!refreshed) {
    if (session) {
      await clearSession();
    }
    return NextResponse.json({ available: true, signedIn: false } satisfies SessionResponse);
  }

  if (refreshed !== session) {
    await writeSession(refreshed);
  }

  return NextResponse.json({
    available: true,
    signedIn: true,
    login: refreshed.login,
    name: refreshed.name,
    avatarUrl: refreshed.avatarUrl,
  } satisfies SessionResponse);
}
