import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isCrossOriginRequest } from '@/lib/auth/config';
import { clearSession, readSession } from '@/lib/auth/session';

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

/**
 * Read-only on purpose: every browser call is a GET, and other methods getting a
 * 405 keeps the token in the cookie unable to write, whatever the GitHub App's
 * permissions. Next answers HEAD with this handler too.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (isCrossOriginRequest(request.headers)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in to GitHub.' }, { status: 401 });
  }

  const { path } = await context.params;
  if (path.some((segment) => segment === '..' || segment === '.')) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  // Assigned through the pathname setter, which can't change the host: resolving
  // the path against the origin instead would read an empty first segment as
  // protocol-relative and send the token to whatever host followed.
  const upstreamUrl = new URL(GITHUB_API_ORIGIN);
  upstreamUrl.pathname = path.map(encodeURIComponent).join('/');
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

  // A session's token never changes and its cookie expires with it, so GitHub
  // rejecting it means the user revoked the app. Drop the session so the visitor
  // falls back to anonymous rather than failing every request until signing out.
  if (upstreamResponse.status === 401) {
    await clearSession();
  }

  const responseHeaders = copyHeaders(upstreamResponse.headers, FORWARDED_RESPONSE_HEADERS);
  // Let the browser hold a copy but revalidate every time, so it sends the etag
  // back and GitHub can answer 304 for free. No `Vary: Cookie` is needed: every
  // reuse is revalidated against GitHub with the current visitor's token.
  responseHeaders.set('cache-control', 'private, max-age=0, must-revalidate');
  responseHeaders.set('vary', 'Accept');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
