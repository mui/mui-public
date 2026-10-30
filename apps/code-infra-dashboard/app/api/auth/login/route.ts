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

/** Leaves headroom under the 4096-byte cap for the cookie's name. */
const MAX_STATE_COOKIE_VALUE_LENGTH = 3500;

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
  const withReturnTo = new URLSearchParams({
    state,
    returnTo: request.nextUrl.searchParams.get('returnTo') ?? '',
  });
  // Browsers drop a cookie whose name and value exceed 4096 bytes, state and all,
  // so a return path that won't fit is given up: the user lands on the home page
  // instead. Next percent-encodes the value once more when it sets the cookie.
  const stored =
    encodeURIComponent(withReturnTo.toString()).length <= MAX_STATE_COOKIE_VALUE_LENGTH
      ? withReturnTo
      : new URLSearchParams({ state });
  response.cookies.set(OAUTH_STATE_COOKIE, stored.toString(), {
    ...BASE_COOKIE_OPTIONS,
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
