import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { fetchDummyRelease } from './__fixtures__/fetchDummyRelease';
import type { ResponseFixture } from './__fixtures__/github';
import { createGitHub, FORBIDDEN, RATE_LIMITED, shaOf } from './__fixtures__/github';

describe('changes', () => {
  it('describes a pull request', async () => {
    const message = '[button] Fix it (#1)\n\nCloses #2';
    const github = createGitHub({
      commits: [
        {
          message,
          pulls: [
            {
              number: 1,
              title: '[button] Edited after the merge',
              body: 'The description',
              login: 'octocat',
              association: 'MEMBER',
              labels: ['component: button', 'type: bug'],
            },
          ],
        },
      ],
    });

    expect((await fetchDummyRelease(github)).changes).toEqual([
      {
        title: '[button] Fix it',
        message,
        sha: shaOf(0),
        url: 'https://github.com/mui/test/pull/1',
        labels: ['component: button', 'type: bug'],
        pullRequest: {
          number: 1,
          title: '[button] Edited after the merge',
          body: 'The description',
        },
        author: { login: 'octocat', name: null, association: 'team' },
        createdAt: '2026-01-01T10:00:00Z',
        mergedAt: '2026-01-01T12:00:00Z',
      },
    ]);
  });

  it('does not mistake issue references for the pull request', async () => {
    const github = createGitHub({
      commits: [
        { message: 'Fix crash (#100) (#1)', pulls: [{ number: 1 }] },
        { message: 'Revert "Fix crash (#100)" (#2)', pulls: [{ number: 2 }] },
        { message: 'Fix it (#3)\n\nFixes #100, see also (#101)', pulls: [{ number: 3 }] },
      ],
      pulls: [{ number: 100 }, { number: 101 }],
    });

    expect((await fetchDummyRelease(github)).changes).toMatchObject([
      { title: 'Fix crash (#100)', pullRequest: { number: 1 } },
      { title: 'Revert "Fix crash (#100)"', pullRequest: { number: 2 } },
      { title: 'Fix it', pullRequest: { number: 3 } },
    ]);
  });

  it('picks the pull request that was merged as the commit', async () => {
    const contained = [
      { number: 3, mergedAt: null },
      { number: 2, mergeCommitSha: 'b'.repeat(40) },
    ];
    const github = createGitHub({
      commits: [
        { message: 'Fix it (#1)', pulls: [...contained, { number: 1 }] },
        { message: 'Contained only', pulls: contained },
      ],
    });

    expect((await fetchDummyRelease(github)).changes).toMatchObject([
      { pullRequest: { number: 1 } },
    ]);
  });

  it('finds a pull request that GitHub does not list for its commit', async () => {
    const github = createGitHub({
      commits: [
        { message: 'Fix it (#9) (#1)' },
        { message: 'Refer to another change (#1)' },
        { message: 'Refer to an open change (#2)' },
        { message: 'Revert "Fix it (#1)"' },
      ],
      pulls: [
        { number: 1, mergeCommitSha: shaOf(0), login: 'octocat', labels: ['type: bug'] },
        { number: 2, mergedAt: null, mergeCommitSha: shaOf(2) },
      ],
    });

    expect((await fetchDummyRelease(github)).changes).toMatchObject([
      {
        title: 'Fix it (#9)',
        sha: shaOf(0),
        url: 'https://github.com/mui/test/pull/1',
        labels: ['type: bug'],
        pullRequest: { number: 1 },
        author: { login: 'octocat' },
      },
    ]);
  });

  it('only includes commits without a pull request on request', async () => {
    const message = 'Fix issue (#999)\n\nCloses #1000';
    const github = createGitHub({
      commits: [{ message, login: 'octocat' }],
      pulls: [{ number: 999 }],
    });

    expect((await fetchDummyRelease(github)).changes).toEqual([]);
    expect((await fetchDummyRelease(github, { includeDirectCommits: true })).changes).toEqual([
      {
        title: 'Fix issue (#999)',
        message,
        sha: shaOf(0),
        url: `https://github.com/mui/test/commit/${shaOf(0)}`,
        labels: [],
        pullRequest: null,
        author: { login: 'octocat', name: 'Git Author', association: 'community' },
        createdAt: '2026-01-01T00:00:00Z',
        mergedAt: '2026-01-02T00:00:00Z',
      },
    ]);
  });

  it('does not fail on a pull request that no longer exists', async () => {
    const github = createGitHub({
      commits: [
        { message: 'Merged by a deleted account (#40)' },
        { message: 'Fix it (#41)', pulls: [{ number: 41 }] },
      ],
    });

    expect((await fetchDummyRelease(github)).changes).toMatchObject([{ title: 'Fix it' }]);
  });

  it('lists releases of any size completely and oldest first', async () => {
    const commits = Array.from({ length: 250 }, (_, index) => ({ message: `Commit ${index}` }));
    const github = createGitHub({
      commits,
      // Finishing out of order must not reorder the changes.
      responses: Object.fromEntries(
        commits.map((_, index) => [
          `/repos/mui/test/commits/${shaOf(index)}/pulls`,
          async () => {
            await sleep((index * 7) % 10);
            return { status: 200, body: [] };
          },
        ]),
      ),
    });

    const { changes } = await fetchDummyRelease(github, { includeDirectCommits: true });

    expect(changes.map((change) => change.title)).toEqual(commits.map(({ message }) => message));
  });
});

describe('failures', () => {
  const COMMITS = [
    {
      message: 'First (#1)',
      pulls: [{ number: 1, login: 'github-actions[bot]', body: 'Cherry-pick of #10' }],
    },
    { message: 'Second (#2)', login: 'octocat' },
  ];

  const BAD_REQUEST = { status: 400, body: { message: 'Bad Request' } };

  it.each<[string, number, ResponseFixture]>(
    [
      '/repos/mui/test/commits/v1.1.0',
      '/repos/mui/test/compare/v1.0.0...v1.1.0',
      `/repos/mui/test/commits/${shaOf(0)}/pulls`,
      '/repos/mui/test/pulls/2',
      '/repos/mui/test/pulls/10',
      '/orgs/mui/members/octocat',
    ].flatMap((path): [string, number, ResponseFixture][] => [
      [path, RATE_LIMITED.status, RATE_LIMITED],
      [path, BAD_REQUEST.status, BAD_REQUEST],
    ]),
  )('surfaces a failure of %s with %d', async (path, status, response) => {
    const github = createGitHub({
      commits: COMMITS,
      pulls: [{ number: 10 }],
      responses: { [path]: response },
    });

    await expect(fetchDummyRelease(github, { includeDirectCommits: true })).rejects.toMatchObject({
      status,
    });
  });

  it('stops making requests once one fails', async () => {
    const commits = Array.from({ length: 30 }, (_, index) => ({ message: `Commit ${index}` }));
    const github = createGitHub({
      commits,
      responses: Object.fromEntries(
        commits.map((_, index) => [
          `/repos/mui/test/commits/${shaOf(index)}/pulls`,
          async () => {
            if (index === 3) {
              return FORBIDDEN;
            }
            await sleep(20);
            return { status: 200, body: [] };
          },
        ]),
      ),
    });

    await expect(fetchDummyRelease(github)).rejects.toThrow('Forbidden');
    await sleep(60);

    expect(github.requests.filter((path) => path.endsWith('/pulls'))).toHaveLength(10);
  });
});
