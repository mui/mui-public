import { vi, describe, it, expect, afterEach } from 'vitest';
import { SESSION_QUERY_KEY } from '../hooks/useSession';
import { proxiedOctokit } from './github';
import { queryClient } from './queryClient';

const DASHBOARD_ORIGIN = 'https://dashboard.example.com';

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
  vi.stubGlobal('window', { location: new URL(DASHBOARD_ORIGIN) });
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
      `${DASHBOARD_ORIGIN}/api/github/repos/acme/widgets/issues?per_page=1`,
      `${DASHBOARD_ORIGIN}/api/github/repos/acme/widgets/issues?per_page=1&page=2`,
    ]);
  });

  it('refreshes the session and retries once when the proxy rejects the token', async () => {
    let rejectedOnce = false;
    const requested = stubBrowser((url) => {
      if (url === '/api/auth/session') {
        return jsonResponse({ available: true, signedIn: true, login: 'octocat' });
      }
      if (!rejectedOnce) {
        rejectedOnce = true;
        return new Response('{}', { status: 401 });
      }
      return jsonResponse({ login: 'octocat' });
    });

    const { data } = await proxiedOctokit.rest.users.getAuthenticated();

    expect(data).toEqual({ login: 'octocat' });
    expect(requested).toEqual([
      `${DASHBOARD_ORIGIN}/api/github/user`,
      '/api/auth/session',
      `${DASHBOARD_ORIGIN}/api/github/user`,
    ]);
  });

  // A revoked token, or a session that couldn't be refreshed: the components
  // reading the session have to learn about it to switch back to anonymous.
  it('publishes a signed-out session to the rest of the app', async () => {
    stubBrowser((url) =>
      url === '/api/auth/session'
        ? jsonResponse({ available: true, signedIn: false })
        : new Response('{}', { status: 401 }),
    );

    await expect(proxiedOctokit.rest.users.getAuthenticated()).rejects.toMatchObject({
      status: 401,
    });
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({
      available: true,
      signedIn: false,
    });
  });
});
