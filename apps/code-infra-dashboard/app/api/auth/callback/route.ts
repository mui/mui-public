import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { Octokit } from '@octokit/rest';
import {
  OAUTH_STATE_COOKIE,
  NO_STORE,
  OAUTH_STATE_COOKIE_PATH,
  REDIRECT_URI,
  getOAuthClient,
  resolveReturnTo,
} from '@/lib/auth/config';
import { describeGitHubError } from '@/lib/auth/describeGitHubError';
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
): Promise<{ session: Session; tokenExpiresAt?: string } | null> {
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

    // Any refresh token is deliberately dropped: the session ends with the token,
    // so the cookie never holds a refresh token.
    return {
      session: {
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatar_url,
        token: authentication.token,
      },
      tokenExpiresAt: 'expiresAt' in authentication ? authentication.expiresAt : undefined,
    };
  } catch (error) {
    // Codes are single-use, so reloading this URL ends up here as well as a
    // misconfigured client secret; only the latter needs anyone's attention.
    console.error(
      `GitHub sign-in: exchanging the authorization code failed: ${describeGitHubError(error)}`,
    );
    return null;
  }
}

/**
 * A callback carrying this browser's state sends the user back to where they
 * started; any other lands on the dashboard root. Only a matching state and a
 * successful code exchange also sign them in; cancelling on GitHub's consent
 * screen, a reloaded or forged callback, or a failed exchange all leave them as
 * they were.
 *
 * The state cookie is only cleared once its state is used: a sign-in started in a
 * second tab replaces the cookie, and the first tab's callback then mismatches. If
 * that cleared it, the second tab's sign-in would fail too.
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
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = stored.get('state');
  if (!state || !expectedState || !matchesState(state, expectedState)) {
    return NextResponse.redirect(resolveReturnTo(null), { headers: NO_STORE });
  }

  const response = NextResponse.redirect(resolveReturnTo(stored.get('returnTo')), {
    headers: NO_STORE,
  });
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_STATE_COOKIE_PATH });
  if (!code) {
    return response;
  }
  const signedIn = await exchangeCodeForSession(client, code);
  if (signedIn) {
    await writeSession(signedIn.session, signedIn.tokenExpiresAt);
  }
  return response;
}
