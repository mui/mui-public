import { describe, it, expect } from 'vitest';
import { rewriteLinkHeader } from './githubProxy';

const PROXY_BASE = 'https://dashboard.example.com/api/github';

describe('rewriteLinkHeader', () => {
  it('points the next and last pages back at the proxy', () => {
    const link =
      '<https://api.github.com/repos/acme/widgets/issues/1/reactions?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repos/acme/widgets/issues/1/reactions?per_page=100&page=5>; rel="last"';

    expect(rewriteLinkHeader(link, PROXY_BASE)).toMatchInlineSnapshot(
      `"<https://dashboard.example.com/api/github/repos/acme/widgets/issues/1/reactions?per_page=100&page=2>; rel="next", <https://dashboard.example.com/api/github/repos/acme/widgets/issues/1/reactions?per_page=100&page=5>; rel="last""`,
    );
  });

  it('preserves the query string, which carries the page cursor', () => {
    const link =
      '<https://api.github.com/search/issues?q=repo%3Aacme%2Fwidgets&page=3>; rel="next"';

    expect(rewriteLinkHeader(link, PROXY_BASE)).toBe(
      '<https://dashboard.example.com/api/github/search/issues?q=repo%3Aacme%2Fwidgets&page=3>; rel="next"',
    );
  });

  it('leaves links to other hosts alone', () => {
    const link =
      '<https://docs.github.com/rest/reference/issues>; rel="deprecation"; type="text/html"';

    expect(rewriteLinkHeader(link, PROXY_BASE)).toBe(link);
  });

  it('rewrites only the GitHub API entries in a mixed header', () => {
    const link =
      '<https://api.github.com/repos/acme/widgets/issues?page=2>; rel="next", ' +
      '<https://docs.github.com/rest/reference/issues>; rel="deprecation"';

    expect(rewriteLinkHeader(link, PROXY_BASE)).toBe(
      '<https://dashboard.example.com/api/github/repos/acme/widgets/issues?page=2>; rel="next", ' +
        '<https://docs.github.com/rest/reference/issues>; rel="deprecation"',
    );
  });

  it('leaves unparsable URLs untouched rather than corrupting the header', () => {
    const link = '<not-a-url>; rel="next"';

    expect(rewriteLinkHeader(link, PROXY_BASE)).toBe(link);
  });

  it('returns an empty header unchanged', () => {
    expect(rewriteLinkHeader('', PROXY_BASE)).toBe('');
  });
});
