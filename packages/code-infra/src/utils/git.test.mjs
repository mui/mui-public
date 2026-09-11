import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { execa } from 'execa';
import { detectBaseBranch, resolveBaseline } from './git.mjs';

/**
 * A repository with three commits on `main`.
 *
 * A real repository rather than a stand-in for git: every question here is about what git reports —
 * which refnames exist, where two branches diverge — and faking that would only restate the answer
 * the code already assumes.
 * @returns {Promise<{ repoRoot: string, shas: string[], git: (...args: string[]) => Promise<any> }>}
 */
async function makeRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-test-'));
  onTestFinished(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  // Everything through the environment rather than `git config`, so the repo needs no extra
  // processes. The two `GIT_CONFIG_*` variables are what make the second half true: without them a
  // contributor's own `commit.gpgsign` or `core.hooksPath` still applies, and these commits fail
  // for a reason that has nothing to do with the code under test.
  /** @param {string} [date] Commit date, so ranking by recency is not left to the clock. */
  const gitWith =
    (date) =>
    (/** @type {string[]} */ ...args) =>
      execa('git', args, {
        cwd: repoRoot,
        env: {
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.com',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.com',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_SYSTEM: '/dev/null',
          ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
        },
      });
  const git = gitWith(undefined);

  await git('init', '--initial-branch=main');
  // A day apart each: `closestBaseBranch` picks the candidate whose merge base is most recent, and
  // three commits made in a loop otherwise share a second and leave that comparison to a tie-break.
  for (const [index, message] of ['first', 'second', 'third'].entries()) {
    // Empty commits: nothing here reads a file, only the commits' identities matter.
    // eslint-disable-next-line no-await-in-loop
    await gitWith(`2020-01-0${index + 1}T00:00:00Z`)('commit', '--allow-empty', '-m', message);
  }
  const { stdout } = await git('log', '--format=%H', '--reverse');
  return { repoRoot, shas: stdout.trim().split('\n'), git };
}

describe('resolveBaseline', () => {
  it('uses the previous commit when HEAD is on the base branch', async () => {
    const { repoRoot, shas } = await makeRepo();

    const sha = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(sha).toBe(shas[1]);
  });

  it('uses the fork point when HEAD is on a branch', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // Branch off the first commit, so the fork point is not simply HEAD~1.
    await git('checkout', '-b', 'feature', shas[0]);
    await git('commit', '--allow-empty', '-m', 'work');

    const sha = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(sha).toBe(shas[0]);
  });

  it('prefers the remote whose fork point is most recent', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // `upstream` is the preferred remote on a tie, so it is deliberately the *stale* one here:
    // picking by recency has to override that preference, and a "first candidate wins" reading would
    // answer `upstream` instead.
    await git('update-ref', 'refs/remotes/upstream/main', shas[0]);
    await git('update-ref', 'refs/remotes/origin/main', shas[1]);
    await git('checkout', '-b', 'feature');
    await git('commit', '--allow-empty', '-m', 'work');
    // Drop the local `main`, which is a candidate in its own right and sits ahead of both remotes —
    // it would win on recency and say nothing about which remote was chosen.
    await git('branch', '-D', 'main');

    const sha = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(sha).toBe(shas[1]);
  });

  it('does not treat a branch matching the base branch as a pattern', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // `v6-x`, not `v6.x` — only a regex reading `.` as a wildcard would accept it.
    await git('update-ref', 'refs/remotes/origin/v6-x', shas[0]);
    await git('checkout', '-b', 'feature');

    const sha = await resolveBaseline({ cwd: repoRoot, baseBranch: 'v6.x' });

    // No base branch exists, so it falls back to the previous commit. Matching `origin/v6-x` would
    // instead have picked its merge base — the first commit — and compared against the wrong one.
    expect(sha).toBe(shas[1]);
  });
});

describe('detectBaseBranch', () => {
  it('reads the default branch from origin/HEAD', async () => {
    const { repoRoot, git } = await makeRepo();
    await git('remote', 'add', 'origin', repoRoot);
    await git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');

    expect(await detectBaseBranch(repoRoot)).toBe('trunk');
  });

  it('reads it from another remote when origin records none', async () => {
    // A remote added by hand has no HEAD unless someone wrote one. If they did, it still counts.
    const { repoRoot, git } = await makeRepo();
    await git('remote', 'add', 'upstream', repoRoot);
    await git('update-ref', 'refs/remotes/upstream/release', 'HEAD');
    await git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/release');

    expect(await detectBaseBranch(repoRoot)).toBe('release');
  });

  it('does not take a conventional name as evidence', async () => {
    // The branch exists, but nothing says it is the default.
    const { repoRoot, git } = await makeRepo();
    await git('remote', 'add', 'origin', repoRoot);
    await git('update-ref', 'refs/remotes/origin/main', 'HEAD');

    await expect(detectBaseBranch(repoRoot)).rejects.toThrow(/no remote records a default branch/);
  });

  it('fails when there is no remote at all', async () => {
    const { repoRoot } = await makeRepo();

    await expect(detectBaseBranch(repoRoot)).rejects.toThrow(/Could not tell which branch/);
  });
});

describe('resolveBaseline without history', () => {
  it('explains that a root commit has nothing behind it', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-root-'));
    onTestFinished(async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    });
    const env = {
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    await execa('git', ['init', '--initial-branch=main'], { cwd: repoRoot, env });
    await execa('git', ['commit', '--allow-empty', '-m', 'first'], { cwd: repoRoot, env });

    // A shallow clone reaches the same place, which is the common one: the parent was never fetched.
    await expect(resolveBaseline({ cwd: repoRoot, baseBranch: 'main' })).rejects.toThrow(
      /HEAD has no parent commit/,
    );
  });
});
