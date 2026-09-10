import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { execa } from 'execa';
import { resolveBaseline } from './git.mjs';

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

  // Identity through the environment rather than `git config`, so the repo needs no extra processes
  // and nothing depends on the machine's own git configuration.
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
