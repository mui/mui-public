import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clearSession, readSession } from '@/lib/auth/session';
import { isTokenExpired } from '@/lib/auth/tokens';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const USER_AGENT = 'mui-code-infra-dashboard';

/**
 * `if-none-match` and `if-modified-since` are the point of this list: a
 * conditional request that GitHub answers with 304 does not count against the
 * hourly quota, so passing them through is most of the rate-limit win.
 */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'if-none-match',
  'if-modified-since',
  'x-github-api-version',
];

/**
 * `link` goes back untouched: its next-page URLs point at api.github.com, and
 * the browser's Octokit routes those through this proxy itself.
 */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
  'link',
  'retry-after',
  'x-github-media-type',
  'x-github-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
];

function copyHeaders(source: Headers, names: string[]): Headers {
  const target = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value) {
      target.set(name, value);
    }
  }
  return target;
}

/** Next answers HEAD with this handler too. */
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  // SameSite=Lax already blocks cross-site XHR; this is belt and braces, since
  // the cookie behind it carries a GitHub token.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  // An expired token is refused rather than refreshed here: refreshing rotates
  // the refresh token, and only /api/auth/session does that, once, before the
  // browser retries. This route only ever clears the session, never writes it.
  const session = await readSession();
  if (!session || isTokenExpired(session)) {
    return NextResponse.json({ error: 'Not signed in to GitHub.' }, { status: 401 });
  }

  const { path } = await context.params;
  if (path.some((segment) => segment === '..' || segment === '.')) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  const upstreamUrl = new URL(`/${path.map(encodeURIComponent).join('/')}`, GITHUB_API_ORIGIN);
  upstreamUrl.search = request.nextUrl.searchParams.toString();

  const upstreamHeaders = copyHeaders(request.headers, FORWARDED_REQUEST_HEADERS);
  // Browsers refuse to let fetch set user-agent, so Octokit's never arrives.
  upstreamHeaders.set('user-agent', USER_AGENT);
  upstreamHeaders.set('authorization', `Bearer ${session.token}`);

  // Redirects are followed here rather than handed to the browser: GitHub
  // redirects renamed and transferred repositories to another api.github.com
  // URL, which the browser would request directly, without the token.
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    cache: 'no-store',
    redirect: 'follow',
  });

  // GitHub rejecting a token we haven't seen expire means it was revoked. Drop
  // the session so the visitor falls back to anonymous instead of every request
  // failing until they sign out by hand.
  if (upstreamResponse.status === 401) {
    await clearSession();
  }

  const responseHeaders = copyHeaders(upstreamResponse.headers, FORWARDED_RESPONSE_HEADERS);
  // Let the browser hold a copy but revalidate every time, so it sends the etag
  // back and GitHub can answer 304 for free. Deliberately no `Vary: Cookie`: the
  // session cookie rotates on refresh and would throw the cache away each time.
  responseHeaders.set('cache-control', 'private, max-age=0, must-revalidate');
  responseHeaders.set('vary', 'Accept');

  // The Response constructor rejects a body on a 304.
  return new Response(upstreamResponse.status === 304 ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
