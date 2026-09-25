import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { isTokenExpired } from '@/lib/auth/tokens';
import {
  FORWARDED_REQUEST_HEADERS,
  FORWARDED_RESPONSE_HEADERS,
  GITHUB_API_ORIGIN,
  PROXY_PREFIX,
  rewriteLinkHeader,
} from '@/lib/githubProxy';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

const USER_AGENT = 'mui-code-infra-dashboard';

/**
 * Built from the forwarded host rather than DASHBOARD_ORIGIN, which falls back to
 * the production URL and would send a local browser's pagination to production.
 */
function getProxyBase(request: NextRequest): string {
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return new URL(PROXY_PREFIX, `${proto}://${host}`).toString();
}

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  // SameSite=Lax already blocks cross-site XHR; this is belt and braces, since
  // the cookie behind it carries a GitHub token.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in to use the GitHub proxy.', code: 'unauthenticated' },
      { status: 401 },
    );
  }

  // Refreshing happens only in /api/auth/session, so that a single request owns
  // the refresh-token rotation. Tell the client to go do that and retry.
  if (isTokenExpired(session)) {
    return NextResponse.json(
      { error: 'GitHub token expired.', code: 'token_expired' },
      { status: 401 },
    );
  }

  const { path } = await context.params;
  if (path.some((segment) => segment === '..' || segment === '.')) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  const upstreamUrl = new URL(`/${path.map(encodeURIComponent).join('/')}`, GITHUB_API_ORIGIN);
  upstreamUrl.search = request.nextUrl.searchParams.toString();

  const upstreamHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      upstreamHeaders.set(name, value);
    }
  }
  // Browsers refuse to let fetch set user-agent, so Octokit's never arrives.
  upstreamHeaders.set('user-agent', USER_AGENT);
  upstreamHeaders.set('authorization', `Bearer ${session.token}`);

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    cache: 'no-store',
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }

  const link = upstreamResponse.headers.get('link');
  if (link) {
    responseHeaders.set('link', rewriteLinkHeader(link, getProxyBase(request)));
  }

  // Let the browser hold a copy but revalidate every time, so it sends the etag
  // back and GitHub can answer 304 for free. Deliberately no `Vary: Cookie`: the
  // session cookie rotates on refresh and would throw the cache away each time.
  responseHeaders.set('cache-control', 'private, max-age=0, must-revalidate');
  responseHeaders.set('vary', 'Accept');

  // The Response constructor rejects a body on a 304.
  if (upstreamResponse.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context);
}
