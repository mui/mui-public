import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isCrossOriginRequest } from '@/lib/auth/config';
import { clearSession } from '@/lib/auth/session';

/**
 * POST so that a link or prefetch can't sign someone out, and same-origin only so
 * that another site's auto-submitting form can't either.
 * The GitHub token is dropped rather than revoked, because the same app backs
 * the code-infra CLI and revoking would sign the user out of that too.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  await clearSession();
  return NextResponse.json({ signedOut: true });
}
