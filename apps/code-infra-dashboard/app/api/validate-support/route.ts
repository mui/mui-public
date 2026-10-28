import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { validateSupportKey, SUPPORT_VALIDATION_REPOS } from '@/lib/validateSupport';
import type { ValidateSupportResult } from '@/lib/validateSupport';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const requestSchema = z.object({
  repo: z.string(),
  issueId: z.coerce.number().int().positive(),
  supportKey: z.string().min(1).max(200),
});

// Every attempt opens an SSH tunnel and a connection to the production store
// database, and this endpoint is public, so cap how often a single client can try.
const rateLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

function jsonResponse(
  result: ValidateSupportResult,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(result, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const { allowed, retryAfterSeconds } = rateLimiter.check(getClientIp(request));
  if (!allowed) {
    return jsonResponse(
      { status: 'error', message: 'Too many attempts. Please try again in a few minutes.' },
      429,
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body.' }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { status: 'error', message: 'Provide a repository, an issue id and your support key.' },
      400,
    );
  }

  if (!SUPPORT_VALIDATION_REPOS.has(parsed.data.repo)) {
    return jsonResponse(
      { status: 'error', message: 'This repository is not set up for support key validation.' },
      400,
    );
  }

  try {
    return jsonResponse(await validateSupportKey(parsed.data), 200);
  } catch (error) {
    // The store database or GitHub is unreachable. Say so, rather than letting the
    // customer believe their support key is at fault.
    console.error('Support key validation failed:', error);
    return jsonResponse(
      {
        status: 'error',
        message: 'Validation is temporarily unavailable. Please try again later.',
      },
      503,
    );
  }
}
