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
  const git = (/** @type {string[]} */ ...args) =>
    execa('git', args, {
      cwd: repoRoot,
      env: {
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com',
      },
    });

  await git('init', '--initial-branch=main');
  for (const message of ['first', 'second', 'third']) {
    // Empty commits: nothing here reads a file, only the commits' identities matter.
    // eslint-disable-next-line no-await-in-loop
    await git('commit', '--allow-empty', '-m', message);
  }
  const { stdout } = await git('log', '--format=%H', '--reverse');
  return { repoRoot, shas: stdout.trim().split('\n'), git };
}

describe('resolveBaseline', () => {
  it('uses the previous commit when HEAD is on the base branch', async () => {
    const { repoRoot, shas } = await makeRepo();

    const baseline = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(baseline.sha).toBe(shas[1]);
  });

  it('uses the fork point when HEAD is on a branch', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // Branch off the first commit, so the fork point is not simply HEAD~1.
    await git('checkout', '-b', 'feature', shas[0]);
    await git('commit', '--allow-empty', '-m', 'work');

    const baseline = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(baseline.sha).toBe(shas[0]);
    expect(baseline.reason).toContain('main');
  });

  it('prefers the remote whose fork point is most recent', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // A stale fork and an up-to-date upstream, the case that makes hardcoding `origin` wrong.
    await git('update-ref', 'refs/remotes/origin/main', shas[0]);
    await git('update-ref', 'refs/remotes/upstream/main', shas[1]);
    await git('checkout', '-b', 'feature');
    await git('commit', '--allow-empty', '-m', 'work');

    const baseline = await resolveBaseline({ cwd: repoRoot, baseBranch: 'main' });

    expect(baseline.sha).toBe(shas[1]);
    expect(baseline.reason).toContain('upstream/main');
  });

  it('does not treat a branch matching the base branch as a pattern', async () => {
    const { repoRoot, shas, git } = await makeRepo();
    // `v6-x`, not `v6.x` — only a regex reading `.` as a wildcard would accept it.
    await git('update-ref', 'refs/remotes/origin/v6-x', shas[0]);
    await git('checkout', '-b', 'feature');

    const baseline = await resolveBaseline({ cwd: repoRoot, baseBranch: 'v6.x' });

    // No base branch exists, so it falls back to the previous commit. Matching `origin/v6-x` would
    // instead have picked its merge base — the first commit — and compared against the wrong one.
    expect(baseline.sha).toBe(shas[1]);
  });
});
