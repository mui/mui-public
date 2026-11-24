import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PullFixture, ReleaseRepository } from './__fixtures__/releaseRepository';
import { createRepository, tempDir, writeFiles } from './__fixtures__/releaseRepository';
// eslint-disable-next-line import/extensions
import { fetchReleaseFacts } from './index.mjs';

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

/** The facts of the remote's main branch since v1.0.0, seen from a fresh checkout. */
async function factsOf(
  repository: ReleaseRepository,
  options: Parameters<typeof fetchReleaseFacts>[0] = {},
) {
  const { dir } = await repository.clone();
  return fetchReleaseFacts({ cwd: dir, octokit: repository.octokit, ...options });
}

describe('release', () => {
  it('needs no options inside a checkout', async () => {
    const repository = await createRepository();
    const sha = await repository.land('[button] Fix it (#1)', [{ number: 1 }], {
      'package.json': { name: 'root', version: '1.1.0' },
    });
    const before = Date.now();

    const facts = await factsOf(repository);

    expect(facts).toMatchObject({
      repository: { owner: 'mui', name: repository.name },
      previous: { ref: 'v1.0.0', sha: await repository.git('rev-parse', 'v1.0.0') },
      release: { ref: sha, sha },
      version: '1.1.0',
      changes: [{ title: '[button] Fix it' }],
      packages: [{ name: 'root', versionChanged: true }],
    });
    expect(Date.parse(facts.date)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(facts.date)).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });

  it('uses the options it is given', async () => {
    const repository = await createRepository();
    const first = await repository.land('First (#1)', [{ number: 1 }]);
    await repository.git('branch', 'feature/branch');
    await repository.land('Second (#2)', [{ number: 2 }]);

    const facts = await factsOf(repository, {
      release: 'feature/branch',
      lastRelease: 'v1.0.0',
      version: '3.0.0',
      date: new Date('2020-01-01'),
    });

    expect(facts).toMatchObject({
      release: { ref: 'feature/branch', sha: first },
      version: '3.0.0',
      date: '2020-01-01T00:00:00.000Z',
      changes: [{ title: 'First' }],
    });
  });

  it('finds the workspace from one of its subdirectories', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/a/package.json': { name: 'a', version: '4.0.0' },
      'packages/a/src/index.js': '',
    });
    await repository.land('First (#1)', [{ number: 1 }]);
    const { dir } = await repository.clone();

    const facts = await fetchReleaseFacts({
      cwd: path.join(dir, 'packages/a/src'),
      octokit: repository.octokit,
    });

    expect(facts.version).toBe('1.0.0');
    expect(facts.packages.map((pkg) => pkg.path)).toEqual(['.', 'packages/a']);
  });

  it('includes a version bump that is not committed yet', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }]);
    const { dir } = await repository.clone();
    await writeFiles(dir, { 'package.json': { name: 'root', version: '1.1.0' } });

    const facts = await fetchReleaseFacts({ cwd: dir, octokit: repository.octokit });

    expect(facts.version).toBe('1.1.0');
    expect(facts.packages).toMatchObject([{ version: '1.1.0', versionChanged: true }]);
  });

  it('takes the version, date and range of a version tag from the tag', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }]);
    await repository.git('tag', 'v1.1.0-alpha.0');
    await repository.git('tag', 'not-a-version');

    const facts = await factsOf(repository, { release: 'v1.1.0-alpha.0' });

    expect(facts).toMatchObject({
      previous: { ref: 'v1.0.0' },
      // Not 1.0.0, which the root package.json was left at.
      version: '1.1.0-alpha.0',
      date: '2026-01-02T00:00:00.000Z',
      changes: [{ title: 'First' }],
    });
  });

  it('ignores tags that are not versions', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }]);
    await repository.git('tag', 'vale-rules');
    await repository.land('Second (#2)', [{ number: 2 }]);

    expect((await factsOf(repository)).previous.ref).toBe('v1.0.0');
  });

  describe('on a maintenance branch', () => {
    async function createMaintainedRepository() {
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
      return repository;
    }

    const expected = {
      previous: { ref: 'v1.0.1' },
      version: '1.0.2',
      changes: [{ title: 'Next patch' }],
      packages: [{ version: '1.0.2', previousVersion: '1.0.1' }],
    };

    it('starts at its own latest tag', async () => {
      const repository = await createMaintainedRepository();
      const { dir } = await repository.clone('--branch=v1.x', '--single-branch');

      const facts = await fetchReleaseFacts({ cwd: dir, octokit: repository.octokit });

      expect(facts).toMatchObject(expected);
    });

    it('can be released from a checkout of another branch', async () => {
      const repository = await createMaintainedRepository();
      const { dir } = await repository.clone('--branch=main', '--single-branch');

      const facts = await fetchReleaseFacts({
        cwd: dir,
        octokit: repository.octokit,
        release: 'v1.x',
      });

      expect(facts).toMatchObject(expected);
    });
  });

  it('works without a checkout when the repository and refs are given', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }], {
      'package.json': { name: 'root', version: '1.1.0' },
    });

    const facts = await fetchReleaseFacts({
      cwd: await tempDir(),
      octokit: repository.octokit,
      repo: repository.name,
      lastRelease: 'v1.0.0',
      release: 'main',
    });

    expect(facts).toMatchObject({
      version: '1.1.0',
      changes: [{ title: 'First' }],
      packages: [{ name: 'root', previousVersion: '1.0.0' }],
    });
  });

  it('does not mistake the surrounding checkout for the repository it is given', async () => {
    const repository = await createRepository();
    const other = await createRepository({
      'nested/pnpm-workspace.yaml': '',
      'nested/package.json': { name: 'other', version: '9.0.0' },
    });
    const { dir } = await other.clone();

    const facts = await fetchReleaseFacts({
      cwd: path.join(dir, 'nested'),
      octokit: repository.octokit,
      repo: repository.name,
      lastRelease: 'v1.0.0',
      release: 'main',
    });

    expect(facts.packages).toMatchObject([{ name: 'root', version: '1.0.0' }]);
  });

  it('explains how to fix a HEAD that is not pushed', async () => {
    const repository = await createRepository();
    const { dir, git } = await repository.clone();
    await git('commit', '--allow-empty', '-m', 'Local');
    const sha = await git('rev-parse', 'HEAD');

    await expect(fetchReleaseFacts({ cwd: dir, octokit: repository.octokit })).rejects.toThrow(
      `HEAD (${sha}) is not on GitHub in mui/${repository.name}. Push it, or pass a \`release\` ref that is already pushed.`,
    );
    expect(repository.requests).toHaveLength(1);
  });

  it('does not blame HEAD when the repository is not accessible', async () => {
    const repository = await createRepository();
    const sha = await repository.git('rev-parse', 'HEAD');
    repository.respondWith(`commits/${sha}`, { status: 404, body: { message: 'Not Found' } });

    await expect(factsOf(repository)).rejects.toThrow(/^Not Found/);
  });

  it('keeps the original error of an unknown ref', async () => {
    const repository = await createRepository();

    await expect(factsOf(repository, { release: 'v9.9.9' })).rejects.toThrow(
      /^No commit found for SHA: v9\.9\.9/,
    );
    await expect(factsOf(repository, { lastRelease: 'v9.9.9' })).rejects.toThrow(
      /^No commit found for SHA: v9\.9\.9/,
    );
  });

  it('explains that there is no tag to start from', async () => {
    const repository = await createRepository();
    await repository.git('tag', '-d', 'v1.0.0');

    await expect(factsOf(repository)).rejects.toThrow(/No version tag found behind \w+/);
  });

  it('requires a version', async () => {
    const repository = await createRepository({ 'package.json': { name: 'root' } });
    await repository.land('First (#1)', [{ number: 1 }]);

    await expect(factsOf(repository)).rejects.toThrow('Pass the `version` of the release.');
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

    const { changes } = await factsOf(repository);

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

  it.each([
    ['Fix crash (#100) (#1)', 'Fix crash (#100)'],
    ['Revert "Fix crash (#100)" (#1)', 'Revert "Fix crash (#100)"'],
    ['Fix #100 and #101 (#1)', 'Fix #100 and #101'],
    ['Fix crash (#1)\n\nFixes #100, see also (#101)', 'Fix crash'],
  ])('does not mistake issue references for the pull request in %j', async (message, title) => {
    const repository = await createRepository();
    await repository.land(message, [{ number: 1 }]);
    repository.addPull({ number: 100 });
    repository.addPull({ number: 101 });

    const { changes } = await factsOf(repository);

    expect(changes).toMatchObject([{ title, pullRequest: { number: 1 } }]);
  });

  it('finds pull requests that the message does not mention', async () => {
    const repository = await createRepository();
    await repository.land('[select] Fix it', [{ number: 1, title: '[select] Fix it' }]);
    await repository.land('Merge pull request #2 from someone/branch', [
      { number: 2, title: '[menu] Fix it' },
    ]);

    const { changes } = await factsOf(repository);

    expect(changes).toMatchObject([
      { title: '[select] Fix it', pullRequest: { number: 1 } },
      { title: '[menu] Fix it', pullRequest: { number: 2 } },
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

    const { changes } = await factsOf(repository);

    expect(changes).toMatchObject([{ pullRequest: { number: 1 } }]);
  });

  it('leaves out commits without a pull request', async () => {
    const repository = await createRepository();
    await repository.push('Fix issue (#999)', 'octocat');
    repository.addPull({ number: 999 });

    expect((await factsOf(repository)).changes).toEqual([]);
    expect(repository.requests).not.toContain('/orgs/mui/members/octocat');
  });

  it('includes commits without a pull request on request, with their issue references', async () => {
    const repository = await createRepository();
    const message = 'Fix issue (#999)\n\nCloses #1000';
    const sha = await repository.push(message, 'octocat');
    repository.addPull({ number: 999 });

    const { changes } = await factsOf(repository, { includeDirectCommits: true });

    expect(changes).toEqual([
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

    expect((await factsOf(repository)).changes).toMatchObject([{ title: 'Fix it' }]);
    expect((await factsOf(repository, { includeDirectCommits: true })).changes).toMatchObject([
      { title: 'Merged by a deleted account (#40)', pullRequest: null },
      { title: 'Fix it' },
    ]);
  });

  it.each([
    ['OWNER', 'team'],
    ['MEMBER', 'team'],
    ['COLLABORATOR', 'community'],
    ['CONTRIBUTOR', 'community'],
    ['FIRST_TIMER', 'first-timer'],
    ['FIRST_TIME_CONTRIBUTOR', 'first-timer'],
    ['NONE', 'first-timer'],
  ])('classifies %s as %s', async (association, expected) => {
    const repository = await createRepository();
    await repository.land('Fix it (#1)', [{ number: 1, association }]);

    expect((await factsOf(repository)).changes[0].author?.association).toBe(expected);
  });

  it('never credits a bot as a first-timer', async () => {
    const repository = await createRepository();
    await repository.land('Bump it (#1)', [
      { number: 1, login: 'renovate[bot]', association: 'NONE' },
    ]);

    expect((await factsOf(repository)).changes[0].author?.association).toBe('community');
  });

  it('has no author when the account was deleted', async () => {
    const repository = await createRepository();
    await repository.land('Fix it (#1)', [{ number: 1, login: null }]);

    expect((await factsOf(repository)).changes[0].author).toBe(null);
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

    const { changes } = await factsOf(repository, { includeDirectCommits: true });

    expect(changes.map((change) => change.title)).toEqual(
      Array.from({ length: 250 }, (_, index) => `Commit ${index}`),
    );
  }, 60_000);

  it('fails rather than returning an incomplete release', async () => {
    const repository = await createRepository();
    const base = await repository.git('rev-parse', 'HEAD');
    const head = await repository.land('Fix it (#1)', [{ number: 1 }]);
    repository.respondWith(`compare/${base}...${head}`, {
      status: 200,
      body: { url: '', total_commits: 2, commits: [] },
    });

    await expect(factsOf(repository)).rejects.toThrow(
      'GitHub listed 0 of the 2 commits in the release.',
    );
  });

  it('is not affected by a branch that moves meanwhile', async () => {
    const repository = await createRepository();
    const base = await repository.git('rev-parse', 'HEAD');
    const head = await repository.land('Fix it (#1)', [{ number: 1 }]);

    await factsOf(repository, { release: 'main' });

    expect(repository.requests).toContain(`compare/${base}...${head}?per_page=100`);
  });
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
    const { changes } = await factsOf(repository);
    return changes[0];
  }

  it.each([
    'Cherry-pick of #10',
    'Cherry-pick of #10.\r\n\r\nSee #11',
    'Intro\n\ncherry-picked from https://github.com/mui/NAME/pull/10',
    'Cherry pick mui/NAME#10',
  ])('credits the original author of %j', async (body) => {
    const repository = await createRepository();
    await repository.land('Fix it (#1)', [
      {
        number: 1,
        login: 'github-actions[bot]',
        body: body.replace('NAME', repository.name),
        labels: ['cherry-pick'],
      },
    ]);
    repository.addPull(ORIGINAL);
    repository.addPull({ number: 11, login: 'someone-else' });

    expect((await factsOf(repository)).changes[0].author).toEqual(OCTOCAT);
    expect(warnings).toEqual([]);
  });

  it('takes the association from the original pull request', async () => {
    const change = await changeOf({ body: 'Cherry-pick of #10' }, [
      { ...ORIGINAL, association: 'MEMBER' },
    ]);

    expect(change.author).toEqual({ ...OCTOCAT, association: 'team' });
  });

  it('leaves references to the original out of the title', async () => {
    const change = await changeOf({
      title: 'Fix it (#9) (#10) (@renamed-octocat)',
      body: 'Cherry-pick of #10',
    });

    expect(change.title).toBe('Fix it (#9)');
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

      expect((await factsOf(repository)).changes[0].author).toEqual(OCTOCAT);
    },
  );

  it('checks the team membership of authors from other organizations', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [
      { number: 1, login: 'github-actions[bot]', body: 'Cherry-pick of facebook/react#10' },
    ]);
    await repository.land('Second (#2)', [
      { number: 2, login: 'github-actions[bot]', body: 'Cherry-pick of facebook/react#11' },
    ]);
    repository.addPull({ number: 10, login: 'reacter', association: 'MEMBER' }, 'facebook/react');
    repository.addPull({ number: 11, login: 'muier', association: 'NONE' }, 'facebook/react');
    repository.respondWith('/orgs/mui/members/muier', { status: 204 });

    const { changes } = await factsOf(repository);

    expect(changes.map((change) => change.author?.association)).toEqual(['community', 'team']);
  });

  it('follows a cherry-pick of a cherry-pick', async () => {
    const change = await changeOf({ body: 'Cherry-pick of #5' }, [
      { number: 5, login: 'github-actions[bot]', body: 'Cherry-pick of #10' },
      ORIGINAL,
    ]);

    expect(change.author).toEqual(OCTOCAT);
  });

  it('credits the bot that opened the original', async () => {
    const change = await changeOf({ body: 'Cherry-pick of #10' }, [
      { number: 10, login: 'renovate[bot]' },
    ]);

    expect(change.author?.login).toBe('renovate[bot]');
    expect(warnings).toEqual([]);
  });

  it('credits the author that several originals share', async () => {
    const change = await changeOf({ body: 'Cherry-pick of #10, #11 and #12' }, [
      ORIGINAL,
      { number: 11, login: 'octocat' },
      { number: 12, login: 'octocat' },
    ]);

    expect(change.author).toEqual(OCTOCAT);
  });

  it.each<[string, Partial<PullFixture>, PullFixture[]]>([
    [
      'the originals have different authors',
      { body: 'Cherry-pick of #10 and #11' },
      [ORIGINAL, { number: 11, login: 'hubot' }],
    ],
    ['one of the originals does not exist', { body: 'Cherry-pick of #10 and #11' }, [ORIGINAL]],
    ['the original does not exist', { body: 'Cherry-pick of #10' }, []],
    [
      'the account of the original author was deleted',
      { body: 'Cherry-pick of #10' },
      [{ number: 10, login: null }],
    ],
    [
      'it references itself',
      { body: 'Cherry-pick of #10' },
      [{ number: 10, login: 'github-actions[bot]', body: 'Cherry-pick of #10' }],
    ],
    ['only the title names an author', { title: 'Fix it (@octocat)', labels: ['cherry-pick'] }, []],
    [
      'an unrelated pull request is mentioned',
      { body: 'Follows #10', labels: ['cherry-pick'] },
      [ORIGINAL],
    ],
  ])('keeps the bot, with a warning, when %s', async (reason, pull, originals) => {
    const change = await changeOf(pull, originals);

    expect(change.author).toEqual(BOT);
    expect(change.title).toBe(pull.title ?? 'Fix it');
    expect(warnings).toEqual([
      "#1 is a cherry-pick, but its original author can't be determined. github-actions[bot] is credited instead.",
    ]);
  });

  it('keeps the bot, with a warning, when the original is not accessible', async () => {
    const repository = await createRepository();
    await repository.land('Fix it (#1)', [
      { number: 1, login: 'github-actions[bot]', body: 'Cherry-pick of mui/private#10' },
    ]);
    repository.respondWith('/repos/mui/private/pulls/10', FORBIDDEN);

    expect((await factsOf(repository)).changes[0].author).toEqual(BOT);
    expect(warnings).toHaveLength(1);
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
  async function authorsOf(repository: ReleaseRepository) {
    const { changes } = await factsOf(repository, { includeDirectCommits: true });
    return changes.map((change) => change.author);
  }

  it('credits members of the organization as team, asking once for each', async () => {
    const repository = await createRepository();
    await repository.push('First', 'member');
    await repository.push('Second', 'outsider');
    await repository.push('Third', 'member');
    repository.respondWith('/orgs/mui/members/member', { status: 204 });

    expect(await authorsOf(repository)).toMatchObject([
      { login: 'member', association: 'team' },
      { login: 'outsider', association: 'community' },
      { login: 'member', association: 'team' },
    ]);
    expect(repository.requests.filter((request) => request.startsWith('/orgs/'))).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('does not check authors that cannot be members', async () => {
    const repository = await createRepository();
    await repository.push('No account');
    await repository.push('Bot', 'github-actions[bot]');

    expect(await authorsOf(repository)).toEqual([
      { login: null, name: 'Git Author', association: 'community' },
      { login: 'github-actions[bot]', name: 'Git Author', association: 'community' },
    ]);
    expect(repository.requests.filter((request) => request.startsWith('/orgs/'))).toEqual([]);
  });

  const PUBLIC_MEMBERS = 'https://api.github.com/orgs/mui/public_members';

  it.each([
    ['denied', () => FORBIDDEN],
    [
      'limited to public members',
      (login: string) => ({
        status: 404,
        body: { message: 'Not Found' },
        url: `${PUBLIC_MEMBERS}/${login}`,
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

  it('recognizes public members without permission to see the others', async () => {
    const repository = await createRepository();
    await repository.push('First', 'member');
    repository.respondWith('/orgs/mui/members/member', {
      status: 204,
      url: `${PUBLIC_MEMBERS}/member`,
    });

    expect(await authorsOf(repository)).toMatchObject([{ association: 'team' }]);
    expect(warnings).toEqual([]);
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
        fetchReleaseFacts({ cwd: dir, octokit: repository.octokit, includeDirectCommits: true }),
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

    await expect(factsOf(repository)).rejects.toThrow('Bad Request');

    const isPullRequest = (request: string) => request.includes('/pulls');
    expect(repository.requests.filter(isPullRequest)).toHaveLength(10);
    settle();
    await sleep(50);
    expect(repository.requests.filter(isPullRequest)).toHaveLength(10);
  });
});

describe('packages', () => {
  const WORKSPACE =
    'packages:\n  - packages/*\n  - "!packages/excluded"\n  - ./docs/\n  - tools/**\n';

  it('describes the members of the workspace', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/b/package.json': { name: 'b', version: '1.0.0' },
      'packages/a/package.json': { name: '@mui/a', version: '1.0.0' },
      'packages/a/nested/package.json': { name: 'nested', version: '1.0.0' },
      'packages/excluded/package.json': { name: 'excluded', version: '1.0.0' },
      'packages/unnamed/package.json': { private: true },
      'packages/unversioned/package.json': { name: 'unversioned' },
      'docs/package.json': { name: 'docs', version: '1.0.0', private: true },
      'tools/deep/tool/package.json': { name: 'tool', version: '1.0.0' },
      'tools/node_modules/installed/package.json': { name: 'installed', version: '1.0.0' },
      'fixtures/package.json': { name: 'fixture', version: '1.0.0' },
    });
    await repository.land('Release', [], {
      'packages/a/package.json': { name: '@mui/a', version: '1.1.0' },
    });

    const { packages } = await factsOf(repository);

    const unchanged = { previousVersion: '1.0.0', versionChanged: false };
    expect(packages).toEqual([
      { name: 'root', path: '.', version: '1.0.0', private: true, ...unchanged },
      { name: 'docs', path: 'docs', version: '1.0.0', private: true, ...unchanged },
      {
        name: '@mui/a',
        path: 'packages/a',
        version: '1.1.0',
        private: false,
        previousVersion: '1.0.0',
        versionChanged: true,
      },
      { name: 'b', path: 'packages/b', version: '1.0.0', private: false, ...unchanged },
      {
        name: 'unversioned',
        path: 'packages/unversioned',
        version: null,
        private: true,
        previousVersion: null,
        versionChanged: false,
      },
      { name: 'tool', path: 'tools/deep/tool', version: '1.0.0', private: false, ...unchanged },
    ]);
  });

  it('compares versions, not contents', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/bumped/package.json': {
        name: 'bumped',
        version: '1.0.0',
        dependencies: { a: '1' },
      },
      'packages/edited/package.json': {
        name: 'edited',
        version: '1.0.0',
        dependencies: { a: '1' },
      },
    });
    await repository.land('Release', [], {
      'packages/bumped/package.json': {
        name: 'bumped',
        version: '1.0.1',
        dependencies: { a: '2' },
      },
      'packages/edited/package.json': {
        name: 'edited',
        version: '1.0.0',
        dependencies: { a: '2' },
      },
      'packages/edited/index.js': 'edited',
    });

    expect((await factsOf(repository)).packages).toMatchObject([
      { name: 'root' },
      { name: 'bumped', previousVersion: '1.0.0', versionChanged: true },
      { name: 'edited', previousVersion: '1.0.0', versionChanged: false },
    ]);
  });

  it('tells new packages from moved ones', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/old/package.json': { name: 'moved', version: '1.0.0' },
      'fixtures/package.json': { name: 'new', version: '1.0.0' },
    });
    await repository.land('Release', [], {
      'packages/old/package.json': null,
      'packages/moved/package.json': { name: 'moved', version: '1.0.0' },
      'packages/new/package.json': { name: 'new', version: '1.0.0' },
    });

    expect((await factsOf(repository)).packages).toMatchObject([
      { name: 'root' },
      { name: 'moved', previousVersion: '1.0.0', versionChanged: false },
      { name: 'new', previousVersion: null, versionChanged: true },
    ]);
  });

  it('reads the workspace as it is in the release, not in the checkout', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/a/package.json': { name: 'a', version: '1.0.0' },
    });
    await repository.land('Release', [], {
      'packages/a/package.json': { name: 'a', version: '1.1.0' },
    });
    await repository.git('tag', 'v1.1.0');
    await repository.land('Later', [], {
      'packages/a/package.json': { name: 'a', version: '1.2.0' },
      'packages/later/package.json': { name: 'later', version: '1.2.0' },
    });

    expect((await factsOf(repository, { release: 'v1.1.0' })).packages).toMatchObject([
      { name: 'root' },
      { name: 'a', version: '1.1.0', previousVersion: '1.0.0' },
    ]);
  });

  it('includes packages that are added or removed but not committed yet', async () => {
    const repository = await createRepository({
      'pnpm-workspace.yaml': WORKSPACE,
      '.gitignore': 'packages/ignored\n',
      'packages/removed/package.json': { name: 'removed', version: '1.0.0' },
    });
    await repository.land('First (#1)', [{ number: 1 }]);
    const { dir } = await repository.clone();
    await writeFiles(dir, {
      'packages/removed/package.json': null,
      'packages/added/package.json': { name: 'added', version: '1.0.0' },
      'packages/ignored/package.json': { name: 'ignored', version: '1.0.0' },
    });

    const facts = await fetchReleaseFacts({ cwd: dir, octokit: repository.octokit });

    expect(facts.packages).toMatchObject([
      { name: 'root' },
      { name: 'added', versionChanged: true },
    ]);
  });

  async function createNestedRepository() {
    const repository = await createRepository({
      'pnpm-workspace.yaml': 'packages:\n  - inner/packages/*\n',
      'inner/pnpm-workspace.yaml': WORKSPACE,
      'inner/package.json': { name: 'inner-root', version: '5.0.0' },
      'inner/packages/a/package.json': { name: 'a', version: '5.0.0' },
      'packages/a/package.json': { name: 'a', version: '9.0.0' },
    });
    await repository.land('Release', [], {
      'inner/package.json': { name: 'inner-root', version: '5.1.0' },
      'inner/packages/a/package.json': { name: 'a', version: '5.1.0' },
    });
    return repository;
  }

  const NESTED = {
    version: '5.1.0',
    packages: [
      { name: 'inner-root', path: '.', previousVersion: '5.0.0' },
      { name: 'a', path: 'packages/a', version: '5.1.0', previousVersion: '5.0.0' },
    ],
  };

  it('supports a workspace nested in a larger repository', async () => {
    const repository = await createNestedRepository();
    const { dir } = await repository.clone();

    const facts = await fetchReleaseFacts({
      cwd: path.join(dir, 'inner'),
      octokit: repository.octokit,
    });

    expect(facts).toMatchObject(NESTED);
  });

  it('reads refs that are missing locally from GitHub', async () => {
    const repository = await createNestedRepository();
    await repository.land('Later', [], {
      'inner/package.json': { name: 'inner-root', version: '6.0.0' },
    });
    const { dir, git } = await repository.clone('--depth=1');
    const shallow = await git('rev-list', '--all', '--count');

    const facts = await fetchReleaseFacts({
      cwd: path.join(dir, 'inner'),
      octokit: repository.octokit,
      lastRelease: 'v1.0.0',
      release: await repository.git('rev-parse', 'HEAD~1'),
    });

    expect(facts).toMatchObject(NESTED);
    expect(await git('rev-list', '--all', '--count')).toBe(shallow);
  });

  it('compares the working tree with a ref that is missing locally', async () => {
    const repository = await createNestedRepository();
    const { dir } = await repository.clone('--depth=1');

    const facts = await fetchReleaseFacts({
      cwd: path.join(dir, 'inner'),
      octokit: repository.octokit,
      lastRelease: 'v1.0.0',
    });

    expect(facts).toMatchObject(NESTED);
  });

  it('fails rather than comparing with an incomplete file list', async () => {
    const repository = await createRepository();
    const base = await repository.git('rev-parse', 'HEAD');
    await repository.land('Release');
    repository.respondWith(`git/trees/${base}`, {
      status: 200,
      body: { sha: base, tree: [], truncated: true },
    });
    const { dir } = await repository.clone('--depth=1');

    await expect(
      fetchReleaseFacts({ cwd: dir, octokit: repository.octokit, lastRelease: 'v1.0.0' }),
    ).rejects.toThrow(`GitHub truncates the file list of ${base}.`);
  });

  it('only has the root package without a workspace', async () => {
    const repository = await createRepository({
      'package.json': { name: 'solo', version: '1.0.0' },
      'examples/package.json': { name: 'example', version: '1.0.0' },
    });
    await repository.land('Release', [], { 'package.json': { name: 'solo', version: '1.1.0' } });

    expect((await factsOf(repository)).packages).toEqual([
      {
        name: 'solo',
        path: '.',
        version: '1.1.0',
        private: false,
        previousVersion: '1.0.0',
        versionChanged: true,
      },
    ]);
  });

  it('has no packages in a repository without any', async () => {
    const repository = await createRepository();
    await repository.land('Release', [], { 'package.json': null });

    expect((await factsOf(repository, { version: '1.1.0' })).packages).toEqual([]);
  });

  it('does not look for a workspace outside of the repository', async () => {
    const repository = await createRepository();
    await repository.land('First (#1)', [{ number: 1 }]);
    const outer = await tempDir();
    await writeFiles(outer, {
      'pnpm-workspace.yaml': 'packages:\n  - "**"\n',
      'package.json': { name: 'outer', version: '7.0.0' },
    });
    const { dir } = await repository.clone();
    const inner = path.join(outer, 'inner');
    await fs.rename(dir, inner);

    const facts = await fetchReleaseFacts({ cwd: inner, octokit: repository.octokit });

    expect(facts.packages).toMatchObject([{ name: 'root' }]);
  });

  it('recognizes packages from before a migration to a pnpm workspace', async () => {
    const repository = await createRepository({
      'package.json': { name: 'root', version: '1.0.0', workspaces: ['packages/*'] },
      'packages/a/package.json': { name: 'a', version: '1.0.0' },
    });
    await repository.land('Release', [], { 'pnpm-workspace.yaml': WORKSPACE });

    expect((await factsOf(repository)).packages).toMatchObject([
      { name: 'root' },
      { name: 'a', versionChanged: false },
    ]);
  });
});
