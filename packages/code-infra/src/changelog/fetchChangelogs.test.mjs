import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRateLimitRetryTime } from '../utils/github.mjs';
import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';

vi.mock('../utils/github.mjs', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  persistentAuthStrategy: () => ({
    /**
     * @param {(options: unknown) => Promise<unknown>} request
     * @param {unknown} options
     */
    hook: (request, options) => request(options),
  }),
}));

const COMMITS = [1, 2, 3].map((prNumber) => ({
  sha: `sha${prNumber}`,
  commit: { message: `[core] Change ${prNumber} (#${prNumber})` },
}));

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * @param {number} prNumber
 */
function pullRequest(prNumber) {
  return {
    number: prNumber,
    labels: [],
    user: { login: 'octocat' },
    author_association: 'MEMBER',
  };
}

/**
 * Stubs fetch with GitHub responses. `failures` maps a path to responses returned before the real one.
 *
 * @param {Record<string, Response[]>} [failures]
 */
function stubGitHub(failures = {}) {
  /**
   * @param {string} pathname
   */
  const respond = (pathname) => {
    const failure = failures[pathname]?.shift();
    if (failure) {
      return failure;
    }
    if (pathname.includes('/compare/')) {
      // GitHub includes `url`, which stops pagination from flattening the response to `commits`.
      return jsonResponse(200, {
        url: 'https://api.github.com/compare',
        commits: COMMITS,
        total_commits: COMMITS.length,
      });
    }
    const prNumber = Number(pathname.split('/').at(-1));
    return jsonResponse(200, pullRequest(prNumber));
  };
  const fetchMock = vi.fn(async (/** @type {string} */ url) => {
    const response = respond(new URL(url).pathname);
    // Pagination reads the response URL, which a constructed Response leaves empty.
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const fetchCommits = () =>
  fetchCommitsBetweenRefs({ repo: 'material-ui', lastRelease: 'v1.0.0', release: 'master' });

describe('fetchCommitsBetweenRefs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits out a short secondary rate limit', { timeout: 10_000 }, async () => {
    const fetchMock = stubGitHub({
      '/repos/mui/material-ui/pulls/2': [
        jsonResponse(
          403,
          { message: 'You have exceeded a secondary rate limit.' },
          { 'retry-after': '1' },
        ),
      ],
    });

    const commits = await fetchCommits();

    expect(commits.map((commit) => commit.prNumber)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('retries server errors', { timeout: 10_000 }, async () => {
    const fetchMock = stubGitHub({
      '/repos/mui/material-ui/compare/v1.0.0...master': [
        jsonResponse(502, { message: 'Bad Gateway' }),
      ],
      '/repos/mui/material-ui/pulls/3': [jsonResponse(500, { message: 'Server Error' })],
    });

    const commits = await fetchCommits();

    expect(commits.map((commit) => commit.prNumber)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('fails with the rate limit error when the wait is long', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    stubGitHub({
      '/repos/mui/material-ui/compare/v1.0.0...master': [
        jsonResponse(
          403,
          { message: 'API rate limit exceeded' },
          { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        ),
      ],
    });

    const error = await fetchCommits().catch((/** @type {unknown} */ err) => err);

    expect(getRateLimitRetryTime(error)).toEqual(new Date(reset * 1000));
  });
});
