import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { Octokit } from '@octokit/rest';
import { DASHBOARD_ORIGIN } from '@/constants';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  REDIRECT_URI,
  getOAuthClient,
} from '@/lib/auth/config';
import { writeSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

function matchesState(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(receivedBytes, expectedBytes);
}

export async function GET(request: NextRequest) {
  const client = getOAuthClient();
  if (!client) {
    return NextResponse.json(
      { error: 'GitHub sign-in is not configured for this deployment.' },
      { status: 503 },
    );
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !stateCookie) {
    return NextResponse.json({ error: 'Invalid authorization response.' }, { status: 400 });
  }

  // Split on the first colon only: the return path may contain colons itself.
  const separatorIndex = stateCookie.indexOf(':');
  if (separatorIndex === -1) {
    return NextResponse.json({ error: 'Invalid authorization state.' }, { status: 400 });
  }

  const expectedState = stateCookie.slice(0, separatorIndex);
  const returnTo = stateCookie.slice(separatorIndex + 1) || '/';

  if (!matchesState(state, expectedState)) {
    return NextResponse.json({ error: 'Invalid authorization state.' }, { status: 400 });
  }

  const { authentication } = await exchangeWebFlowCode({
    clientType: 'github-app',
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    code,
    redirectUrl: REDIRECT_URI,
  });

  const { data: user } = await new Octokit({
    auth: authentication.token,
  }).rest.users.getAuthenticated();

  await writeSession({
    login: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url,
    token: authentication.token,
    expiresAt: 'expiresAt' in authentication ? authentication.expiresAt : undefined,
    refreshToken: 'refreshToken' in authentication ? authentication.refreshToken : undefined,
    refreshTokenExpiresAt:
      'refreshTokenExpiresAt' in authentication ? authentication.refreshTokenExpiresAt : undefined,
  });

  const response = NextResponse.redirect(new URL(returnTo, DASHBOARD_ORIGIN));
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_STATE_COOKIE_PATH });
  return response;
}
