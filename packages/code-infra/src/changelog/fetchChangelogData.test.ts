import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createGitHub } from './__fixtures__/github';
// eslint-disable-next-line import/extensions
import { fetchChangelogData } from './index.mjs';

// Keeps a contributor's own git config (signing, hooks) out of the fixture commits.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

type Files = Record<string, unknown>;

async function tempDir() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-data-')));
  onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeFiles(dir: string, files: Files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(target), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

/** A local checkout of `mui/test` with a commit of `files` tagged v1.0.0, and what git does in it. */
async function createCheckout(files: Files = {}) {
  const dir = await tempDir();
  const git = async (...args: string[]) =>
    (await execa('git', args, { cwd: dir, env: GIT_ENV })).stdout;

  async function commit(changed: Files, tag?: string) {
    await writeFiles(dir, changed);
    await git('add', '-A');
    await git('commit', '--allow-empty', '-m', 'Commit');
    if (tag) {
      await git('tag', tag);
    }
    return git('rev-parse', 'HEAD');
  }

  await git('init', '--initial-branch=main');
  await git('remote', 'add', 'origin', 'https://github.com/mui/test.git');
  const previous = await commit(
    { 'package.json': { name: 'root', version: '1.0.0', private: true }, ...files },
    'v1.0.0',
  );

  return {
    dir,
    git,
    commit,
    previous,
    /** Makes `origin` a local copy of what is committed so far. */
    async publish() {
      const remote = await tempDir();
      await execa('git', ['clone', '--bare', dir, remote], { env: GIT_ENV });
      await git('config', `url.${remote}.insteadOf`, 'https://github.com/mui/test.git');
    },
  };
}

describe('release', () => {
  it('needs no options inside a checkout', async () => {
    const checkout = await createCheckout();
    const sha = await checkout.commit({});
    await checkout.publish();
    // The version bump of a release isn't necessarily committed yet.
    await writeFiles(checkout.dir, { 'package.json': { name: 'root', version: '1.1.0' } });
    const { octokit } = createGitHub({
      commits: [{ sha, message: 'Fix it (#1)', pulls: [{ number: 1 }] }],
      refs: { 'v1.0.0': checkout.previous },
    });
    const before = Date.now();

    const data = await fetchChangelogData({ cwd: checkout.dir, octokit });

    expect(data).toMatchObject({
      repository: { owner: 'mui', repo: 'test' },
      previous: { ref: 'v1.0.0', sha: checkout.previous },
      release: { ref: sha, sha },
      version: '1.1.0',
      changes: [{ title: 'Fix it' }],
      packages: [{ name: 'root', version: '1.1.0' }],
    });
    expect(Date.parse(data.date)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(data.date)).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('takes the version, date and range of a version tag from the tag', async () => {
    const checkout = await createCheckout();
    const sha = await checkout.commit({}, 'v1.1.0-alpha.0');
    await checkout.publish();
    const { octokit } = createGitHub({ refs: { 'v1.1.0-alpha.0': sha } });

    const data = await fetchChangelogData({
      cwd: checkout.dir,
      octokit,
      release: 'v1.1.0-alpha.0',
    });

    expect(data).toMatchObject({
      previous: { ref: 'v1.0.0' },
      // Not 1.0.0, which the root package.json was left at.
      version: '1.1.0-alpha.0',
      date: '2026-01-02T00:00:00.000Z',
    });
  });

  it('starts at the latest tag of a maintenance branch', async () => {
    const checkout = await createCheckout();
    await checkout.git('checkout', '-b', 'v1.x');
    await checkout.commit({}, 'v1.0.1');
    await checkout.git('checkout', 'main');
    await checkout.commit({}, 'v2.0.0');
    await checkout.git('checkout', 'v1.x');
    await checkout.commit({ 'package.json': { name: 'root', version: '1.0.2' } });
    await checkout.publish();
    // Tags that a checkout doesn't have yet are fetched.
    await checkout.git('tag', '-d', 'v1.0.1');

    const data = await fetchChangelogData({
      cwd: checkout.dir,
      octokit: createGitHub().octokit,
    });

    expect(data).toMatchObject({ previous: { ref: 'v1.0.1' }, version: '1.0.2' });
  });

  it('explains how to fix a HEAD that is not pushed', async () => {
    const checkout = await createCheckout();
    const sha = await checkout.commit({});
    const { octokit, requests } = createGitHub({ refs: { [sha]: null } });

    await expect(fetchChangelogData({ cwd: checkout.dir, octokit })).rejects.toThrow(
      `HEAD (${sha}) is not on GitHub in mui/test. Push it, or pass a \`release\` ref that is already pushed.`,
    );
    expect(requests).toHaveLength(1);
  });
});

describe('packages', () => {
  it('describes the members of the workspace', async () => {
    const checkout = await createCheckout({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - docs\n',
      'packages/b/package.json': { name: 'b', version: '1.0.0' },
      'packages/a/package.json': { name: '@mui/a', version: '1.1.0' },
      'packages/unnamed/package.json': { private: true },
      'packages/unversioned/package.json': { name: 'unversioned' },
      'docs/package.json': { name: 'docs', version: '1.0.0', private: true },
      'fixtures/package.json': { name: 'fixture', version: '1.0.0' },
    });
    await writeFiles(checkout.dir, {
      'packages/a/package.json': { name: '@mui/a', version: '1.2.0' },
      'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1' } },
      'packages/new/package.json': { name: 'new', version: '1.0.0' },
    });
    const { octokit } = createGitHub();

    const { packages, version } = await fetchChangelogData({
      cwd: path.join(checkout.dir, 'packages/a'),
      octokit,
      lastRelease: checkout.previous,
    });

    expect(version).toBe('1.0.0');
    expect(packages).toEqual([
      { name: 'root', path: '.', version: '1.0.0', private: true, changed: false },
      { name: 'docs', path: 'docs', version: '1.0.0', private: true, changed: false },
      { name: '@mui/a', path: 'packages/a', version: '1.2.0', private: false, changed: true },
      { name: 'b', path: 'packages/b', version: '1.0.0', private: false, changed: false },
      { name: 'new', path: 'packages/new', version: '1.0.0', private: false, changed: true },
      {
        name: 'unversioned',
        path: 'packages/unversioned',
        version: null,
        private: true,
        changed: false,
      },
    ]);
  });

  it('does not know what changed when the previous release is missing locally', async () => {
    const checkout = await createCheckout();

    const { packages } = await fetchChangelogData({
      cwd: checkout.dir,
      octokit: createGitHub().octokit,
      lastRelease: 'a'.repeat(40),
    });

    expect(packages).toMatchObject([{ name: 'root', changed: null }]);
  });

  it('only has the root package without a workspace', async () => {
    const checkout = await createCheckout({
      'package.json': { name: 'solo', version: '1.0.0' },
      'examples/package.json': { name: 'example', version: '1.0.0' },
    });

    const { packages } = await fetchChangelogData({
      cwd: checkout.dir,
      octokit: createGitHub().octokit,
      lastRelease: checkout.previous,
    });

    expect(packages).toEqual([
      { name: 'solo', path: '.', version: '1.0.0', private: false, changed: false },
    ]);
  });
});
