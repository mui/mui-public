// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from 'vitest';
import { proxiedOctokit } from './github';

/**
 * Where the tab is: jsdom's default location, local dev, which differs from
 * api.github.com in scheme, host and port, so each part of the rewrite is checked.
 */
const TAB_ORIGIN = window.location.origin;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs the network, recording every URL Octokit ends up requesting. */
function stubFetch(respond: (url: string) => Response): string[] {
  const requested: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    return respond(url);
  };
  vi.stubGlobal('fetch', fakeFetch);
  return requested;
}

describe('proxiedOctokit', () => {
  // GitHub's Link header points the next page at api.github.com. Following it
  // verbatim would send every page after the first around the proxy, anonymously.
  it('sends every page of a paginated request through the proxy', async () => {
    const requested = stubFetch((url) =>
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
