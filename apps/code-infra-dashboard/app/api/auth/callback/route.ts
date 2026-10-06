import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { Octokit } from '@octokit/rest';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  REDIRECT_URI,
  getOAuthClient,
  resolveReturnTo,
} from '@/lib/auth/config';
import { writeSession } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/session';

function matchesState(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(receivedBytes, expectedBytes);
}

async function exchangeCodeForSession(
  client: NonNullable<ReturnType<typeof getOAuthClient>>,
  code: string,
): Promise<Session | null> {
  try {
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

    // Which of these GitHub sends depends on the app's "Expire user authorization
    // tokens" setting: nothing, an expiry alone, or an expiry with a refresh token.
    return {
      login: user.login,
      name: user.name ?? null,
      avatarUrl: user.avatar_url,
      token: authentication.token,
      ...('expiresAt' in authentication ? { expiresAt: authentication.expiresAt } : {}),
      ...('refreshToken' in authentication
        ? {
            refreshToken: authentication.refreshToken,
            refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
          }
        : {}),
    };
  } catch (error) {
    // Codes are single-use, so reloading this URL ends up here as well as a
    // misconfigured client secret; only the latter needs anyone's attention.
    console.error('GitHub sign-in: exchanging the authorization code failed.', error);
    return null;
  }
}

/**
 * Every outcome sends the user back to where they started and clears the state
 * cookie. Only a matching state and a successful code exchange also sign them in;
 * cancelling on GitHub's consent screen, a reloaded or forged callback, or a
 * failed exchange all leave them as they were.
 */
export async function GET(request: NextRequest) {
  const client = getOAuthClient();
  if (!client) {
    return NextResponse.json(
      { error: 'GitHub sign-in is not configured for this deployment.' },
      { status: 503 },
    );
  }

  const stored = new URLSearchParams(request.cookies.get(OAUTH_STATE_COOKIE)?.value);

  const response = NextResponse.redirect(resolveReturnTo(stored.get('returnTo')));
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_STATE_COOKIE_PATH });

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = stored.get('state');
  if (!code || !state || !expectedState || !matchesState(state, expectedState)) {
    return response;
  }

  const session = await exchangeCodeForSession(client, code);
  if (session) {
    await writeSession(session);
  }
  return response;
}
