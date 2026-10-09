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

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);

  // The return path is stored as given: the callback resolves it, and has to
  // treat whatever arrives in this cookie as untrusted regardless.
  const stored = new URLSearchParams({
    state,
    returnTo: request.nextUrl.searchParams.get('returnTo') ?? '',
  });
  response.cookies.set(OAUTH_STATE_COOKIE, stored.toString(), {
    ...BASE_COOKIE_OPTIONS,
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
