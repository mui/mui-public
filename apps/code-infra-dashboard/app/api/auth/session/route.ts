import { NextResponse } from 'next/server';
import type { SessionResponse } from '@/hooks/useSession';
import { getOAuthClient } from '@/lib/auth/config';
import { readSession } from '@/lib/auth/session';

export async function GET() {
  if (!getOAuthClient()) {
    return NextResponse.json({ available: false, signedIn: false } satisfies SessionResponse);
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ available: true, signedIn: false } satisfies SessionResponse);
  }

  return NextResponse.json({
    available: true,
    signedIn: true,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
  } satisfies SessionResponse);
}
