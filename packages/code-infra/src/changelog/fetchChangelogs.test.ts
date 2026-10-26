import { Octokit } from '@octokit/rest';
import { expect, it, vi, onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { fetchCommitsBetweenRefs } from './index.mjs';

const OK = 200;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const INTERNAL_SERVER_ERROR = 500;
const NO_CONTENT = 204;
const DATE = '2026-10-01T00:00:00Z';

it('keeps direct commits and resolves structured cherry-pick attribution', async () => {
  const requests: string[] = [];
  const commits = [
    {
      sha: 'direct-sha',
      commit: { message: 'Fix issue #888', author: { date: '2026-10-01T00:00:00Z' } },
      author: { login: 'direct-author' },
      html_url: 'https://github.com/mui/test/commit/direct-sha',
    },
    {
      sha: 'cherry-sha',
      commit: { message: '[Grid] Fix selection (@original) (#2)' },
      author: { login: 'github-actions[bot]' },
    },
    {
      sha: 'unknown-sha',
      commit: { message: 'Backport fix (#3)' },
      author: { login: 'github-actions[bot]' },
    },
    {
      sha: 'issue-only',
      commit: { message: 'Fix issue (#999)' },
      author: { login: 'direct-author' },
    },
  ];

  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url.pathname);
        if (url.pathname.includes('/members/')) {
          return Response.json({ message: 'Not Found' }, { status: NOT_FOUND });
        }
        if (url.pathname.includes('/compare/')) {
          return Object.defineProperty(
            Response.json(
              { url: url.href, commits, total_commits: commits.length },
              { status: OK },
            ),
            'url',
            { value: url.href },
          );
        }
        const number = Number(url.pathname.split('/').at(-1));
        if (number === 999) {
          return Response.json({ message: 'Not Found' }, { status: NOT_FOUND });
        }
        if (![2, 3].includes(number)) {
          throw new Error(`Unexpected request: ${url}`);
        }
        return Response.json(
          {
            number,
            title: number === 2 ? '[Grid] Fix selection (@original)' : 'Backport fix',
            body: '',
            labels: [{ name: 'cherry-pick' }],
            user: { login: 'github-actions[bot]' },
            author_association: 'NONE',
            merged_at: null,
            created_at: null,
            html_url: `https://github.com/mui/test/pull/${number}`,
          },
          { status: OK },
        );
      },
    },
  });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = await fetchCommitsBetweenRefs({
      octokit,
      repo: 'test',
      lastRelease: 'v1',
      release: 'HEAD',
    });

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      prNumber: null,
      author: { login: 'direct-author' },
      html_url: commits[0].html_url,
    });
    expect(result[1].author?.login).toBe('original');
    expect(result[1].message).not.toContain('(@original)');
    expect(result[2].author?.login).toBe('github-actions[bot]');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('original author'));
    expect(result[3]).toMatchObject({ sha: 'issue-only', prNumber: null });
    expect(requests).not.toContain('/repos/mui/test/pulls/888');
  } finally {
    warning.mockRestore();
  }
});

it('resolves an original PR in its own repository instead of guessing from mentions', async () => {
  const requests: string[] = [];
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url.pathname);
        let data;
        if (url.pathname.includes('/compare/')) {
          data = {
            url: url.href,
            total_commits: 1,
            commits: [{ sha: 'backport', commit: { message: 'Backport fix (#2)' } }],
          };
        } else if (url.pathname === '/repos/mui/test/pulls/2') {
          data = {
            title: 'Backport fix',
            labels: [{ name: 'cherry-pick' }],
            body: 'Reviewer @unrelated\nOriginal PR: https://github.com/mui/source/pull/1',
            user: { login: 'github-actions[bot]' },
            author_association: 'NONE',
            html_url: url.href,
            merged_at: null,
            created_at: null,
          };
        } else if (url.pathname === '/repos/mui/source/pulls/1') {
          data = { user: { login: 'original' }, author_association: 'MEMBER' };
        } else {
          throw new Error(`Unexpected request: ${url}`);
        }
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const [result] = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v1',
    release: 'HEAD',
  });
  expect(result.author).toEqual({ login: 'original', association: 'team' });
  expect(requests).toContain('/repos/mui/source/pulls/1');
});

const RATE_LIMIT_HEADERS: Record<string, string>[] = [
  { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' },
  { 'retry-after': '60' },
];

it.each(RATE_LIMIT_HEADERS)(
  'propagates membership rate limits instead of changing author classification: %j',
  async (headers) => {
    const octokit = new Octokit({
      request: {
        fetch: async (input: Parameters<typeof fetch>[0]) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.pathname.includes('/members/')) {
            return Response.json({ message: 'Forbidden' }, { status: FORBIDDEN, headers });
          }
          return Object.defineProperty(
            Response.json(
              {
                url: url.href,
                total_commits: 1,
                commits: [
                  {
                    sha: 'direct',
                    author: { login: 'author' },
                    commit: { message: 'Direct change' },
                  },
                ],
              },
              { status: OK },
            ),
            'url',
            { value: url.href },
          );
        },
      },
    });
    await expect(
      fetchCommitsBetweenRefs({ octokit, repo: 'test', lastRelease: 'v0', release: 'v1' }),
    ).rejects.toMatchObject({ status: FORBIDDEN });
  },
);

it('aborts pending membership requests when another lookup fails', async () => {
  let memberStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    memberStarted = resolve;
  });
  let aborted = false;
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.includes('/members/')) {
          memberStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          });
        }
        if (url.pathname.includes('/pulls/')) {
          await started;
          return Response.json({ message: 'Unavailable' }, { status: INTERNAL_SERVER_ERROR });
        }
        return Object.defineProperty(
          Response.json(
            {
              url: url.href,
              total_commits: 2,
              commits: [
                {
                  sha: 'direct',
                  author: { login: 'author' },
                  commit: { message: 'Direct change' },
                },
                { sha: 'pr', commit: { message: 'PR change (#1)' } },
              ],
            },
            { status: OK },
          ),
          'url',
          { value: url.href },
        );
      },
    },
  });
  await expect(
    fetchCommitsBetweenRefs({ octokit, repo: 'test', lastRelease: 'v0', release: 'v1' }),
  ).rejects.toMatchObject({ status: INTERNAL_SERVER_ERROR });
  expect(aborted).toBe(true);
});

it('omits merge bookkeeping and PR children without dropping mainline direct changes', async () => {
  const commits = [
    {
      sha: 'base',
      parents: [{ sha: 'outside' }],
      commit: { message: 'Direct mainline change' },
      author: null,
    },
    {
      sha: 'child',
      parents: [{ sha: 'outside' }],
      commit: { message: 'PR implementation' },
      author: null,
    },
    {
      sha: 'sync',
      parents: [{ sha: 'child' }, { sha: 'base' }],
      commit: { message: "Merge branch 'master' into feature" },
      author: null,
    },
    {
      sha: 'merge',
      parents: [{ sha: 'base' }, { sha: 'sync' }],
      commit: { message: 'Merge pull request #1 from feature' },
      author: null,
    },
    {
      sha: 'branch-change',
      parents: [{ sha: 'outside' }],
      commit: { message: 'Direct side-branch change' },
      author: null,
    },
    {
      sha: 'manual',
      parents: [{ sha: 'merge' }, { sha: 'branch-change' }],
      commit: { message: "Merge branch 'master' into v9.x" },
      author: null,
    },
    {
      sha: 'unresolved-child',
      parents: [{ sha: 'manual' }],
      commit: { message: 'Unresolved branch change' },
      author: null,
    },
    {
      sha: 'unresolved',
      parents: [{ sha: 'manual' }, { sha: 'unresolved-child' }],
      commit: { message: 'Merge pull request #999 from feature' },
      author: null,
    },
  ];
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.endsWith('/999')) {
          return Response.json({ message: 'Not Found' }, { status: NOT_FOUND });
        }
        const data = url.pathname.includes('/compare/')
          ? { url: url.href, total_commits: commits.length, commits }
          : {
              title: '[Grid] Actual PR change',
              body: '',
              labels: [],
              user: { login: 'author' },
              author_association: 'MEMBER',
              merged_at: DATE,
              created_at: DATE,
              html_url: url.href,
            };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.map((commit) => commit.sha)).toEqual([
    'base',
    'merge',
    'branch-change',
    'unresolved-child',
  ]);
  expect(result.find((commit) => commit.prNumber === 1)?.message).toBe(
    '[Grid] Actual PR change (#1)',
  );
});

it('classifies direct authors using organization membership', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => warning.mockRestore());
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.includes('/members/')) {
          return url.pathname.endsWith('/team-member')
            ? new Response(null, { status: NO_CONTENT })
            : Response.json(
                { message: 'Not Found' },
                { status: url.pathname.endsWith('/restricted') ? FORBIDDEN : NOT_FOUND },
              );
        }
        const data = {
          url: url.href,
          total_commits: 3,
          commits: ['team-member', 'community-member', 'restricted'].map((login) => ({
            sha: login,
            author: { login },
            commit: { message: 'Direct change' },
          })),
        };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.map((commit) => commit.author)).toEqual([
    { login: 'team-member', association: 'team' },
    { login: 'community-member', association: 'contributor' },
    { login: 'restricted', association: 'contributor' },
  ]);
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining('Cannot check membership for @restricted'),
  );
});

it('cleans human cherry-pick suffixes without changing attribution', async () => {
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const data = url.pathname.includes('/compare/')
          ? {
              url: url.href,
              total_commits: 1,
              commits: [
                { sha: 'human-backport', commit: { message: 'Fix behavior (@original) (#1)' } },
              ],
            }
          : {
              title: 'Fix behavior (@original)',
              body: '',
              labels: [{ name: 'cherry-pick' }],
              user: { login: 'human' },
              author_association: 'MEMBER',
              created_at: DATE,
              merged_at: DATE,
              html_url: url.href,
            };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const [result] = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.author?.login).toBe('human');
  expect(result.message).toBe('Fix behavior (#1)');
});
