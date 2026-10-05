import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth/session';

/**
 * POST rather than GET so that a link or prefetch can't sign someone out.
 * The GitHub token is dropped rather than revoked, because the same app backs
 * the code-infra CLI and revoking would sign the user out of that too.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ signedOut: true });
}
