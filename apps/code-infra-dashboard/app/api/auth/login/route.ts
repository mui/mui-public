import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  BASE_COOKIE_OPTIONS,
  GITHUB_AUTHORIZE_URL,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_MAX_AGE_SECONDS,
  REDIRECT_URI,
  getOAuthClient,
  resolveReturnTo,
} from '@/lib/auth/config';

export async function GET(request: NextRequest) {
  const client = getOAuthClient();
  if (!client) {
    return NextResponse.json(
      { error: 'GitHub sign-in is not configured for this deployment.' },
      { status: 503 },
    );
  }

  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const returnUrl = resolveReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const returnTo = `${returnUrl.pathname}${returnUrl.search}`;

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);

  // The return path rides along with the state so it can't be tampered with
  // independently of the CSRF check that validates it.
  response.cookies.set(OAUTH_STATE_COOKIE, `${state}:${returnTo}`, {
    ...BASE_COOKIE_OPTIONS,
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
