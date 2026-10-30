import { vi, describe, it, expect, afterEach } from 'vitest';
import { proxiedOctokit } from './github';

/**
 * Where the stubbed browser tab is: local dev, which differs from api.github.com
 * in scheme, host and port, so each part of the rewrite is checked.
 */
const TAB_ORIGIN = 'http://localhost:3000';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stands in for a browser tab on the dashboard: stubs its location and its fetch,
 * recording every URL Octokit ends up requesting.
 */
function stubBrowser(respond: (url: string) => Response): string[] {
  const requested: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    return respond(url);
  };
  vi.stubGlobal('fetch', fakeFetch);
  vi.stubGlobal('window', { location: new URL(TAB_ORIGIN) });
  return requested;
}

describe('proxiedOctokit', () => {
  // GitHub's Link header points the next page at api.github.com. Following it
  // verbatim would send every page after the first around the proxy, anonymously.
  it('sends every page of a paginated request through the proxy', async () => {
    const requested = stubBrowser((url) =>
      new URL(url).searchParams.get('page') === '2'
        ? Response.json([{ id: 2 }])
        : Response.json([{ id: 1 }], {
            headers: {
              link: '<https://api.github.com/repos/acme/widgets/issues?per_page=1&page=2>; rel="next"',
            },
          }),
    );

    const issues = await proxiedOctokit.paginate(proxiedOctokit.rest.issues.listForRepo, {
      owner: 'acme',
      repo: 'widgets',
      per_page: 1,
    });

    expect(issues).toEqual([{ id: 1 }, { id: 2 }]);
    expect(requested).toEqual([
      `${TAB_ORIGIN}/api/github/repos/acme/widgets/issues?per_page=1`,
      `${TAB_ORIGIN}/api/github/repos/acme/widgets/issues?per_page=1&page=2`,
    ]);
  });
});
