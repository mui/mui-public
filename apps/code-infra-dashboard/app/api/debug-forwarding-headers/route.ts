import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// TEMPORARY probe, removed before this PR merges. It reports only the forwarding
// headers of the caller's own request, so it discloses nothing the caller does not
// already know about itself. It exists to establish which of these Render's edge
// actually sets, so the rate limiter can key on one a client cannot forge.
export async function GET(request: NextRequest): Promise<Response> {
  return NextResponse.json(
    {
      'x-forwarded-for': request.headers.get('x-forwarded-for'),
      'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
      'true-client-ip': request.headers.get('true-client-ip'),
      'x-real-ip': request.headers.get('x-real-ip'),
      'x-vercel-forwarded-for': request.headers.get('x-vercel-forwarded-for'),
      'cf-ray': request.headers.get('cf-ray'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
