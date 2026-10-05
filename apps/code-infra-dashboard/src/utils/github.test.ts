import { vi, describe, it, expect, afterEach } from 'vitest';
import { proxiedOctokit } from './github';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Stubs the browser's fetch, recording every URL Octokit ends up requesting. */
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
      url.includes('page=2')
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
      '/api/github/repos/acme/widgets/issues?per_page=1',
      '/api/github/repos/acme/widgets/issues?per_page=1&page=2',
    ]);
  });

  it('refreshes the session and retries once when the proxy rejects the token', async () => {
    let rejectedOnce = false;
    const requested = stubFetch((url) => {
      if (url === '/api/auth/session') {
        return jsonResponse({ available: true, signedIn: true });
      }
      if (!rejectedOnce) {
        rejectedOnce = true;
        return new Response('{}', { status: 401 });
      }
      return jsonResponse({ login: 'octocat' });
    });

    const { data } = await proxiedOctokit.rest.users.getAuthenticated();

    expect(data).toEqual({ login: 'octocat' });
    expect(requested).toEqual(['/api/github/user', '/api/auth/session', '/api/github/user']);
  });
});
