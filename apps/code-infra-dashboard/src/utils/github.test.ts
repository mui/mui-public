import { vi, describe, it, expect, afterEach } from 'vitest';
import { sessionQueryOptions } from '../hooks/useSession';
import { proxiedOctokit } from './github';
import { queryClient } from './queryClient';

/** Where the stubbed browser tab is. */
const TAB_ORIGIN = 'https://dashboard.example.com';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

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
        ? jsonResponse([{ id: 2 }])
        : jsonResponse([{ id: 1 }], {
            link: '<https://api.github.com/repos/acme/widgets/issues?per_page=1&page=2>; rel="next"',
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

  // An expired or revoked token: the components reading the session have to
  // learn the visitor is signed out to switch back to anonymous requests.
  it('publishes a signed-out session to the rest of the app when the proxy rejects the token', async () => {
    const requested = stubBrowser((url) =>
      url === '/api/auth/session'
        ? jsonResponse({ available: true, signedIn: false })
        : new Response('{}', { status: 401 }),
    );

    await expect(proxiedOctokit.rest.users.getAuthenticated()).rejects.toMatchObject({
      status: 401,
    });
    expect(queryClient.getQueryData(sessionQueryOptions.queryKey)).toEqual({
      available: true,
      signedIn: false,
    });
    expect(requested).toEqual([`${TAB_ORIGIN}/api/github/user`, '/api/auth/session']);
  });

  it('re-reads the session once for requests rejected together', async () => {
    let sessionReads = 0;
    stubBrowser((url) => {
      if (url === '/api/auth/session') {
        sessionReads += 1;
        return jsonResponse({ available: true, signedIn: false });
      }
      return new Response('{}', { status: 401 });
    });

    await Promise.allSettled([
      proxiedOctokit.rest.users.getAuthenticated(),
      proxiedOctokit.rest.users.getAuthenticated(),
    ]);

    expect(sessionReads).toBe(1);
  });
});
