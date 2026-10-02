export const GITHUB_API_ORIGIN = 'https://api.github.com';

export const PROXY_PREFIX = '/api/github';

/**
 * `if-none-match` and `if-modified-since` are the point of this list: a
 * conditional request that GitHub answers with 304 does not count against the
 * hourly quota, so passing them through is most of the rate-limit win.
 */
export const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'if-none-match',
  'if-modified-since',
  'x-github-api-version',
];

export const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
  'x-github-media-type',
  'x-github-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
];

/**
 * Point a GitHub `Link` header back at our proxy.
 *
 * Octokit's pagination plugin takes the next page's URL verbatim out of this
 * header and requests it directly, ignoring `baseUrl`. Left alone, page 1 would
 * go through the proxy authenticated and every later page would go straight to
 * api.github.com anonymously — burning the visitor's 60/hour IP budget and
 * 404-ing halfway through a private repository.
 *
 * `proxyBase` must be absolute: Octokit only prefixes `baseUrl` onto routes that
 * don't already start with `http`, so a relative replacement would be
 * concatenated into `/api/github/api/github/...`.
 */
export function rewriteLinkHeader(link: string, proxyBase: string): string {
  return link.replace(/<([^<>]+)>/g, (match, rawUrl: string) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return match;
    }
    // Leave documentation links (docs.github.com) pointing where they point.
    if (url.origin !== GITHUB_API_ORIGIN) {
      return match;
    }
    return `<${proxyBase}${url.pathname}${url.search}>`;
  });
}
