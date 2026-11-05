import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteToken } from '@octokit/oauth-methods';
import { getOAuthClient, isCrossOriginRequest } from '@/lib/auth/config';
import { describeGitHubError } from '@/lib/auth/describeGitHubError';
import { clearSession, readSession } from '@/lib/auth/session';

/**
 * POST so that a link or prefetch can't sign someone out, and same-origin only so
 * that another site's auto-submitting form can't either.
 *
 * The token is revoked, not just forgotten: a copy of the cookie would otherwise
 * keep working until it expires, and a non-expiring token never stops working. Only this one token is revoked, so other
 * clients the user signed into with the same GitHub App keep theirs.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  // Without sign-in configured there is no session to end.
  const client = getOAuthClient();
  if (!client) {
    return NextResponse.json({ signedOut: true });
  }

  const session = await readSession();
  if (session) {
    try {
      await deleteToken({
        clientType: 'github-app',
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        token: session.token,
      });
    } catch (error) {
      // Signing out still ends the session here. The token is left to expire,
      // or to be revoked from the user's GitHub settings.
      console.error(
        `GitHub sign-in: revoking the token on sign-out failed: ${describeGitHubError(error)}`,
      );
    }
  }

  await clearSession();
  return NextResponse.json({ signedOut: true });
}
