import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PullFixture, ChangelogRepository } from './__fixtures__/changelogRepository';
import { createRepository, writeFiles } from './__fixtures__/changelogRepository';
// eslint-disable-next-line import/extensions
import { fetchChangelogData } from './index.mjs';

const RATE_LIMITED = {
  status: 403,
  body: { message: 'API rate limit exceeded' },
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4102444800' },
};
const FORBIDDEN = { status: 403, body: { message: 'Resource not accessible by integration' } };

let warnings: string[];

beforeEach(() => {
  warnings = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((message) => warnings.push(message));
  return () => spy.mockRestore();
});

/** The changelog data of the remote's main branch since v1.0.0, seen from a fresh checkout. */
async function dataOf(
  repository: ChangelogRepository,
  options: Parameters<typeof fetchChangelogData>[0] = {},
) {
  const { dir } = await repository.clone();
  return fetchChangelogData({ cwd: dir, octokit: repository.octokit, ...options });
}

describe('release', () => {
  it('needs no options inside a checkout', async () => {
    const repository = await createRepository();
    const sha = await repository.land('[button] Fix it (#1)', [{ number: 1 }]);
    const { dir } = await repository.clone();
    // The version bump of a release isn't necessarily committed yet.
    await writeFiles(dir, { 'package.json': { name: 'root', version: '1.1.0' } });
    const before = Date.now();

    const data = await fetchChangelogData({ cwd: dir, octokit: repository.octokit });

    expect(data).toMatchObject({
      repository: { owner: 'mui', repo: repository.name },
      previous: { ref: 'v1.0.0', sha: await repository.git('rev-parse', 'v1.0.0') },
      release: { ref: sha, sha },
      version: '1.1.0',
      changes: [{ title: '[button] Fix it' }],
      packages: [{ name: 'root', version: '1.1.0' }],
    });
    expect(Date.parse(data.date)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(data.date)).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('takes the version, date and range of a version tag from the tag', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }]);
    await repository.git('tag', 'v1.1.0-alpha.0');
    await repository.git('tag', 'not-a-version');

    const data = await dataOf(repository, { release: 'v1.1.0-alpha.0' });

    expect(data).toMatchObject({
      previous: { ref: 'v1.0.0' },
      // Not 1.0.0, which the root package.json was left at.
      version: '1.1.0-alpha.0',
      date: '2026-01-02T00:00:00.000Z',
      changes: [{ title: 'First' }],
    });
  });

  it('starts at the latest tag of a maintenance branch', async () => {
    const repository = await createRepository();
    await repository.git('checkout', '-b', 'v1.x');
    await repository.land('Patch (#1)', [{ number: 1 }], {
      'package.json': { name: 'root', version: '1.0.1' },
    });
    await repository.git('tag', 'v1.0.1');
    await repository.land('Next patch (#3)', [{ number: 3 }], {
      'package.json': { name: 'root', version: '1.0.2' },
    });
    await repository.git('checkout', 'main');
    await repository.land('Major (#2)', [{ number: 2 }], {
      'package.json': { name: 'root', version: '2.0.0' },
    });
    await repository.git('tag', 'v2.0.0');
    const { dir, git } = await repository.clone('--branch=v1.x');
    // Tags that a checkout doesn't have yet are fetched.
    await git('tag', '-d', 'v1.0.1');

    const data = await fetchChangelogData({ cwd: dir, octokit: repository.octokit });

    expect(data).toMatchObject({
      previous: { ref: 'v1.0.1' },
      version: '1.0.2',
      changes: [{ title: 'Next patch' }],
      packages: [{ version: '1.0.2' }],
    });
  });

  it('explains how to fix a HEAD that is not pushed', async () => {
    const repository = await createRepository();
    const { dir, git } = await repository.clone();
    await git('commit', '--allow-empty', '-m', 'Local');
    const sha = await git('rev-parse', 'HEAD');

    await expect(fetchChangelogData({ cwd: dir, octokit: repository.octokit })).rejects.toThrow(
      `HEAD (${sha}) is not on GitHub in mui/${repository.name}. Push it, or pass a \`release\` ref that is already pushed.`,
    );
    expect(repository.requests).toHaveLength(1);
  });
});

describe('changes', () => {
  it('describes a pull request', async () => {
    const repository = await createRepository();
    const message = '[button] Fix it (#1)\n\nCloses #2';
    const sha = await repository.land(message, [
      {
        number: 1,
        title: '[button] Edited after the merge',
        body: 'The description',
        login: 'octocat',
        association: 'MEMBER',
        labels: ['component: button', 'type: bug'],
      },
    ]);

    const { changes } = await dataOf(repository);

    expect(changes).toEqual([
      {
        title: '[button] Fix it',
        message,
        sha,
        url: `https://github.com/mui/${repository.name}/pull/1`,
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
    const repository = await createRepository();
    await repository.land('Fix crash (#100) (#1)', [{ number: 1 }]);
    await repository.land('Revert "Fix crash (#100)" (#2)', [{ number: 2 }]);
    await repository.land('Fix it (#3)\n\nFixes #100, see also (#101)', [{ number: 3 }]);
    repository.addPull({ number: 100 });
    repository.addPull({ number: 101 });

    expect((await dataOf(repository)).changes).toMatchObject([
      { title: 'Fix crash (#100)', pullRequest: { number: 1 } },
      { title: 'Revert "Fix crash (#100)"', pullRequest: { number: 2 } },
      { title: 'Fix it', pullRequest: { number: 3 } },
    ]);
  });

  it('picks the pull request that was merged as the commit', async () => {
    const repository = await createRepository();
    await repository.land('Fix it (#1)', [
      { number: 3, mergedAt: null, mergeCommitSha: 'a'.repeat(40) },
      { number: 2, mergeCommitSha: 'b'.repeat(40) },
      { number: 1 },
    ]);
    await repository.land('Contained only', [
      { number: 3, mergedAt: null },
      { number: 2, mergeCommitSha: 'b'.repeat(40) },
    ]);

    const { changes } = await dataOf(repository);

    expect(changes).toMatchObject([{ pullRequest: { number: 1 } }]);
  });

  it('only includes commits without a pull request on request', async () => {
    const repository = await createRepository();
    const message = 'Fix issue (#999)\n\nCloses #1000';
    const sha = await repository.push(message, 'octocat');
    repository.addPull({ number: 999 });

    expect((await dataOf(repository)).changes).toEqual([]);
    expect((await dataOf(repository, { includeDirectCommits: true })).changes).toEqual([
      {
        title: 'Fix issue (#999)',
        message,
        sha,
        url: `https://github.com/mui/${repository.name}/commit/${sha}`,
        labels: [],
        pullRequest: null,
        author: { login: 'octocat', name: 'Git Author', association: 'community' },
        createdAt: '2026-01-01T00:00:00Z',
        mergedAt: '2026-01-02T00:00:00Z',
      },
    ]);
  });

  it('does not fail on a pull request that no longer exists', async () => {
    const repository = await createRepository();
    await repository.land('Merged by a deleted account (#40)');
    await repository.land('Fix it (#41)', [{ number: 41 }]);

    expect((await dataOf(repository)).changes).toMatchObject([{ title: 'Fix it' }]);
  });

  it('classifies authors', async () => {
    const repository = await createRepository();
    const associations = ['MEMBER', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR'];
    for (const [index, association] of associations.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await repository.land(`Commit ${index}`, [{ number: index, association }]);
    }

    const { changes } = await dataOf(repository);

    expect(changes.map((change) => change.author?.association)).toEqual([
      'team',
      'community',
      'first-timer',
    ]);
  });

  it('lists releases of any size completely and oldest first', async () => {
    const repository = await createRepository();
    const tree = await repository.git('rev-parse', 'HEAD^{tree}');
    let head = await repository.git('rev-parse', 'HEAD');
    for (let index = 0; index < 250; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      head = await repository.git('commit-tree', tree, '-p', head, '-m', `Commit ${index}`);
      // Finishing out of order must not reorder the changes.
      repository.respondWith(`commits/${head}/pulls`, async () => {
        await sleep((index * 7) % 10);
        return { status: 200, body: [] };
      });
    }
    await repository.git('reset', '--hard', head);

    const { changes } = await dataOf(repository, { includeDirectCommits: true });

    expect(changes.map((change) => change.title)).toEqual(
      Array.from({ length: 250 }, (_, index) => `Commit ${index}`),
    );
  }, 60_000);
});

describe('cherry-picks', () => {
  const ORIGINAL: PullFixture = { number: 10, login: 'octocat', association: 'CONTRIBUTOR' };
  const BOT = { login: 'github-actions[bot]', name: null, association: 'community' };
  const OCTOCAT = { login: 'octocat', name: null, association: 'community' };

  async function changeOf(pull: Partial<PullFixture>, originals: PullFixture[] = [ORIGINAL]) {
    const repository = await createRepository();
    await repository.land(`${pull.title ?? 'Fix it'} (#1)`, [
      { number: 1, login: 'github-actions[bot]', ...pull },
    ]);
    originals.forEach((original) => repository.addPull(original));
    const { changes } = await dataOf(repository);
    return changes[0];
  }

  it('credits the original author', async () => {
    const change = await changeOf({
      title: 'Fix it (#9) (@octocat)',
      body: 'Cherry-pick of #10',
      labels: ['cherry-pick'],
    });

    expect(change).toMatchObject({ title: 'Fix it (#9)', author: OCTOCAT });
    expect(warnings).toEqual([]);
  });

  it.each(['mui/other#10', 'https://github.com/mui/other/pull/10'])(
    'credits the original author across repositories in %s',
    async (reference) => {
      const repository = await createRepository();
      await repository.land('Fix it (#1)', [
        { number: 1, login: 'github-actions[bot]', body: `Cherry-pick of ${reference}` },
      ]);
      // Same number in this repository.
      repository.addPull({ number: 10, login: 'someone-else' });
      // Being new to the other repository doesn't make someone new to this one.
      repository.addPull({ ...ORIGINAL, association: 'FIRST_TIME_CONTRIBUTOR' }, 'mui/other');

      expect((await dataOf(repository)).changes[0].author).toEqual(OCTOCAT);
    },
  );

  it.each<[string, Partial<PullFixture>, PullFixture[]]>([
    ['the original does not exist', { body: 'Cherry-pick of #10' }, []],
    [
      'the originals have different authors',
      { body: 'Cherry-pick of #10 and #11' },
      [ORIGINAL, { number: 11, login: 'hubot' }],
    ],
    ['only the title names an author', { title: 'Fix it (@octocat)', labels: ['cherry-pick'] }, []],
  ])('keeps the bot, with a warning, when %s', async (reason, pull, originals) => {
    const change = await changeOf(pull, originals);

    expect(change.author).toEqual(BOT);
    expect(change.title).toBe(pull.title ?? 'Fix it');
    expect(warnings).toEqual([
      "#1 is a cherry-pick, but its original author can't be determined. github-actions[bot] is credited instead.",
    ]);
  });

  it('does not take a changelog quoted in a dependency bump for a cherry-pick', async () => {
    const change = await changeOf({
      login: 'renovate[bot]',
      body: '- Cherry-pick of [#10](https://example.com)\n> Cherry-pick of #10',
    });

    expect(change.author?.login).toBe('renovate[bot]');
    expect(warnings).toEqual([]);
  });

  it('keeps the person who opened it', async () => {
    const change = await changeOf({
      login: 'maintainer',
      association: 'MEMBER',
      body: 'Cherry-pick of #10',
      labels: ['cherry-pick'],
    });

    expect(change.author).toEqual({ login: 'maintainer', name: null, association: 'team' });
    expect(warnings).toEqual([]);
  });
});

describe('direct commit authors', () => {
  async function authorsOf(repository: ChangelogRepository) {
    const { changes } = await dataOf(repository, { includeDirectCommits: true });
    return changes.map((change) => change.author);
  }

  it('credits members of the organization as team, asking once for each', async () => {
    const repository = await createRepository();
    await repository.push('First', 'member');
    await repository.push('Second', 'outsider');
    await repository.push('Third', 'member');
    await repository.push('No account');
    repository.respondWith('/orgs/mui/members/member', { status: 204 });

    expect(await authorsOf(repository)).toMatchObject([
      { login: 'member', association: 'team' },
      { login: 'outsider', association: 'community' },
      { login: 'member', association: 'team' },
      { login: null, name: 'Git Author', association: 'community' },
    ]);
    expect(repository.requests.filter((request) => request.startsWith('/orgs/'))).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['denied', () => FORBIDDEN],
    [
      'limited to public members',
      (login: string) => ({
        status: 404,
        body: { message: 'Not Found' },
        url: `https://api.github.com/orgs/mui/public_members/${login}`,
      }),
    ],
  ])('warns once and credits community when the check is %s', async (name, response) => {
    const repository = await createRepository();
    for (const login of ['one', 'two']) {
      // eslint-disable-next-line no-await-in-loop
      await repository.push(login, login);
      repository.respondWith(`/orgs/mui/members/${login}`, response(login));
    }

    expect(await authorsOf(repository)).toMatchObject([
      { association: 'community' },
      { association: 'community' },
    ]);
    expect(warnings).toEqual([
      expect.stringMatching(/^The token can't read the private members of mui\./),
    ]);
  });
});

describe('failures', () => {
  it.each([
    ['rate limit', RATE_LIMITED, 403],
    ['unexpected error', { status: 400, body: { message: 'Bad Request' } }, 400],
  ])('surfaces a %s in any request', async (name, response, status) => {
    const repository = await createRepository();
    const base = await repository.git('rev-parse', 'HEAD');
    const first = await repository.land('First (#1)', [
      { number: 1, login: 'github-actions[bot]', body: 'Cherry-pick of #10' },
    ]);
    await repository.push('Second', 'octocat');
    repository.addPull({ number: 10 });
    const head = await repository.git('rev-parse', 'HEAD');

    for (const route of [
      `commits/${head}`,
      `compare/${base}...${head}`,
      `commits/${first}/pulls`,
      'pulls/10',
      '/orgs/mui/members/octocat',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { dir } = await repository.clone();
      const restore = repository.respondWith(route, response);
      // eslint-disable-next-line no-await-in-loop
      await expect(
        fetchChangelogData({ cwd: dir, octokit: repository.octokit, includeDirectCommits: true }),
        route,
      ).rejects.toMatchObject({ status });
      restore();
    }
    expect(warnings).toEqual([]);
  });

  it('stops making requests once one fails', async () => {
    const repository = await createRepository();
    const shas: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      shas.push(await repository.land(`Commit ${index}`));
    }
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    onTestFinished(settle);
    shas.forEach((sha, index) => {
      repository.respondWith(`commits/${sha}/pulls`, async () => {
        if (index === 3) {
          return { status: 400, body: { message: 'Bad Request' } };
        }
        await settled;
        return { status: 200, body: [] };
      });
    });

    await expect(dataOf(repository)).rejects.toThrow('Bad Request');

    const isPullRequest = (request: string) => request.includes('/pulls');
    expect(repository.requests.filter(isPullRequest)).toHaveLength(10);
    settle();
    await sleep(50);
    expect(repository.requests.filter(isPullRequest)).toHaveLength(10);
  });
});

describe('packages', () => {
  it('describes the members of the workspace', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - docs\n',
      'packages/b/package.json': { name: 'b', version: '1.0.0' },
      'packages/a/package.json': { name: '@mui/a', version: '1.1.0' },
      'packages/unnamed/package.json': { private: true },
      'packages/unversioned/package.json': { name: 'unversioned' },
      'docs/package.json': { name: 'docs', version: '1.0.0', private: true },
      'fixtures/package.json': { name: 'fixture', version: '1.0.0' },
    });
    await repository.land('First (#1)', [{ number: 1 }]);
    const { dir } = await repository.clone();

    const { packages, version } = await fetchChangelogData({
      cwd: path.join(dir, 'packages/a'),
      octokit: repository.octokit,
    });

    expect(version).toBe('1.0.0');
    expect(packages).toEqual([
      { name: 'root', path: '.', version: '1.0.0', private: true },
      { name: 'docs', path: 'docs', version: '1.0.0', private: true },
      { name: '@mui/a', path: 'packages/a', version: '1.1.0', private: false },
      { name: 'b', path: 'packages/b', version: '1.0.0', private: false },
      { name: 'unversioned', path: 'packages/unversioned', version: null, private: true },
    ]);
  });

  it('only has the root package without a workspace', async () => {
    const repository = await createRepository({
      'package.json': { name: 'solo', version: '1.0.0' },
      'examples/package.json': { name: 'example', version: '1.0.0' },
    });
    await repository.land('First (#1)', [{ number: 1 }]);

    expect((await dataOf(repository)).packages).toEqual([
      { name: 'solo', path: '.', version: '1.0.0', private: false },
    ]);
  });
});
