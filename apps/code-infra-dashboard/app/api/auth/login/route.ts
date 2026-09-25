import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  GITHUB_AUTHORIZE_URL,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_MAX_AGE_SECONDS,
  REDIRECT_URI,
  getOAuthClient,
} from '@/lib/auth/config';
import { isSessionConfigured } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Only same-origin paths may be returned to. Rejects absolute URLs and
 * protocol-relative "//evil.example", both of which would leave the dashboard.
 */
function sanitizeReturnTo(requested: string | null): string {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
    return '/';
  }
  return requested;
}

export async function GET(request: NextRequest) {
  const client = getOAuthClient();
  if (!client || !isSessionConfigured()) {
    return NextResponse.json(
      { error: 'GitHub sign-in is not configured for this deployment.' },
      { status: 503 },
    );
  }

  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);

  // The return path rides along with the state so it can't be tampered with
  // independently of the CSRF check that validates it.
  response.cookies.set(OAUTH_STATE_COOKIE, `${state}:${returnTo}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
