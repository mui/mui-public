import { NextResponse } from 'next/server';
import { getOAuthClient } from '@/lib/auth/config';
import { clearSession, isSessionConfigured, readSession, writeSession } from '@/lib/auth/session';
import { getRefreshedSession } from '@/lib/auth/tokens';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

export interface SessionResponse {
  /** Whether a browser login is possible at all in this deployment. */
  available: boolean;
  signedIn: boolean;
  login?: string;
  name?: string | null;
  avatarUrl?: string;
}

/**
 * The single place that refreshes an expired GitHub token. Keeping it here -- and
 * not in the API proxy -- means only one request at a time can rotate the refresh
 * token, because the client serialises this call behind a single react-query
 * query. The proxy stays a pure passthrough that never writes cookies.
 */
export async function GET() {
  const available = Boolean(getOAuthClient()) && isSessionConfigured();

  if (!available) {
    return NextResponse.json({ available: false, signedIn: false } satisfies SessionResponse);
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ available: true, signedIn: false } satisfies SessionResponse);
  }

  const refreshed = await getRefreshedSession(session);
  if (!refreshed) {
    await clearSession();
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
