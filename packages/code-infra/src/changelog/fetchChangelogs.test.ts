import { Octokit } from '@octokit/rest';
import { expect, it, vi } from 'vitest';
// eslint-disable-next-line import/extensions
import { fetchCommitsBetweenRefs } from './index.mjs';

const OK = 200;
const NOT_FOUND = 404;

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
