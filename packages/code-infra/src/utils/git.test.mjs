import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { execa } from 'execa';
import { resolveBaseline } from './git.mjs';

// Keeps a contributor's own git config (signing, hooks) out of the fixture commits.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

/** @param {string} prefix */
async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} cwd */
function gitIn(cwd) {
  return (/** @type {string[]} */ ...args) => execa('git', args, { cwd, env: GIT_ENV });
}

/**
 * A remote repository with `commits` on `main`.
 * @param {string[]} [commits]
 */
async function makeRemote(commits = ['first', 'second', 'third']) {
  const dir = await tempDir('baseline-remote-');
  const git = gitIn(dir);
  await git('init', '--initial-branch=main');
  for (const message of commits) {
    // eslint-disable-next-line no-await-in-loop
    await git('commit', '--allow-empty', '-m', message);
  }
  const { stdout } = await git('log', '--format=%H', '--reverse');
  return { dir, git, shas: stdout.trim().split('\n') };
}

/**
 * Clones `remoteDir` as `origin`.
 * @param {string} remoteDir
 * @param {string[]} [cloneArgs]
 */
async function clone(remoteDir, cloneArgs = []) {
  const dir = await tempDir('baseline-clone-');
  await execa('git', ['clone', ...cloneArgs, remoteDir, dir], { env: GIT_ENV });
  return { dir, git: gitIn(dir) };
}

/**
 * A clone whose `origin` is a fork stuck at the first commit, with `remote` reachable under
 * `remoteName`, and a `feature` branch forked from the remote's second commit.
 * @param {string} remoteName
 */
async function makeForkClone(remoteName) {
  const remote = await makeRemote();
  const fork = await clone(remote.dir);
  await fork.git('reset', '--hard', remote.shas[0]);
  const work = await clone(fork.dir);
  await work.git('remote', 'add', remoteName, remote.dir);
  await work.git('fetch', remoteName);
  await work.git('checkout', '-b', 'feature', remote.shas[1]);
  await work.git('commit', '--allow-empty', '-m', 'work');
  return { remote, work };
}

describe('resolveBaseline', () => {
  it('uses the parent commit when HEAD is on the base branch', async () => {
    const remote = await makeRemote();
    const work = await clone(remote.dir);

    expect(await resolveBaseline({ cwd: work.dir })).toBe(remote.shas[1]);
  });

  it('uses the fork point when HEAD is on a branch', async () => {
    const remote = await makeRemote();
    const work = await clone(remote.dir);
    await work.git('checkout', '-b', 'feature', remote.shas[0]);
    await work.git('commit', '--allow-empty', '-m', 'work');

    expect(await resolveBaseline({ cwd: work.dir })).toBe(remote.shas[0]);
  });

  it('fetches the base branch a CI checkout does not have', async () => {
    const remote = await makeRemote();
    await remote.git('checkout', '-b', 'feature', remote.shas[0]);
    await remote.git('commit', '--allow-empty', '-m', 'work');
    await remote.git('checkout', 'main');
    const work = await clone(remote.dir, ['--single-branch', '--branch', 'feature']);

    expect(await resolveBaseline({ cwd: work.dir })).toBe(remote.shas[0]);
  });

  it('measures from the base branch it is given', async () => {
    const remote = await makeRemote();
    await remote.git('checkout', '-b', 'release', remote.shas[0]);
    await remote.git('commit', '--allow-empty', '-m', 'release fix');
    const { stdout: releaseTip } = await remote.git('rev-parse', 'HEAD');
    await remote.git('checkout', 'main');
    const work = await clone(remote.dir);
    await work.git('checkout', '-b', 'feature', 'origin/release');
    await work.git('commit', '--allow-empty', '-m', 'work');

    expect(await resolveBaseline({ cwd: work.dir, baseBranch: 'release' })).toBe(releaseTip.trim());
  });

  it('fails for a base branch the remote does not have', async () => {
    const remote = await makeRemote();
    const work = await clone(remote.dir);

    await expect(resolveBaseline({ cwd: work.dir, baseBranch: 'no-such-branch' })).rejects.toThrow(
      /no-such-branch/,
    );
  });

  it('explains that a root commit has nothing behind it', async () => {
    const remote = await makeRemote(['first']);
    const work = await clone(remote.dir);

    await expect(resolveBaseline({ cwd: work.dir })).rejects.toThrow(/HEAD has no parent commit/);
  });
});

describe('resolveBaseline: the canonical remote', () => {
  it('prefers upstream over origin', async () => {
    const { remote, work } = await makeForkClone('upstream');

    expect(await resolveBaseline({ cwd: work.dir })).toBe(remote.shas[1]);
  });

  it('uses the remote it is given', async () => {
    const { remote, work } = await makeForkClone('mui');

    expect(await resolveBaseline({ cwd: work.dir, remote: 'mui' })).toBe(remote.shas[1]);
  });

  it('goes by name, not by what a remote points at', async () => {
    // Unless it is named, `mui` is just another remote and the fork's `origin` is canonical.
    const { remote, work } = await makeForkClone('mui');

    expect(await resolveBaseline({ cwd: work.dir })).toBe(remote.shas[0]);
  });

  it('fails for a remote the repository does not have', async () => {
    const remote = await makeRemote();
    const work = await clone(remote.dir);

    await expect(resolveBaseline({ cwd: work.dir, remote: 'mui' })).rejects.toThrow(/'mui'/);
  });

  it('fails without upstream or origin', async () => {
    const remote = await makeRemote();
    const work = await clone(remote.dir);
    await work.git('remote', 'rename', 'origin', 'mui');

    await expect(resolveBaseline({ cwd: work.dir })).rejects.toThrow(/No canonical remote/);
  });
});
