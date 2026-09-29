import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { makeTempDir } from '../utils/testUtils';
import { resolveBaselineRef } from './refs';

/**
 * A repository with three commits on `main`, the first of them carrying an annotated tag.
 *
 * A real repository rather than a stand-in for git: every behaviour here is a question about what
 * git reports — what a tag resolves to, which refnames exist — and a fake would only restate the
 * answer the code already assumes.
 */
async function makeRepo(): Promise<{ repoRoot: string; shas: string[] }> {
  const repoRoot = await makeTempDir();
  // Identity through the environment rather than `git config`, so the repo needs no extra processes
  // and nothing depends on the machine's own git configuration.
  const git = (...args: string[]) =>
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
  // Empty commits: nothing here reads a file, only the commits' identities matter.
  for (const message of ['first', 'second', 'third']) {
    // eslint-disable-next-line no-await-in-loop
    await git('commit', '--allow-empty', '-m', message);
  }
  const { stdout } = await git('log', '--format=%H', '--reverse');
  const shas = stdout.trim().split('\n');

  // Annotated (`-m`), so the tag is its own object with its own SHA.
  await git('tag', '-a', 'v1.0.0', '-m', 'release', shas[0]);

  return { repoRoot, shas };
}

describe('resolveBaselineRef', () => {
  it('takes a bare value as a revision', async () => {
    const { repoRoot, shas } = await makeRepo();

    const ref = await resolveBaselineRef(shas[0], repoRoot);

    expect(ref.sha).toBe(shas[0]);
  });

  it('takes the same revision behind the git scheme', async () => {
    const { repoRoot, shas } = await makeRepo();

    const ref = await resolveBaselineRef(`git:${shas[0]}`, repoRoot);

    expect(ref.sha).toBe(shas[0]);
  });

  it('resolves an annotated tag to the commit it points at', async () => {
    const { repoRoot, shas } = await makeRepo();

    const ref = await resolveBaselineRef('v1.0.0', repoRoot);

    // Without `^{commit}` this is the tag object's own SHA, which is not a commit at all.
    expect(ref.sha).toBe(shas[0]);
  });

  it('falls back to the previous commit when nothing names one', async () => {
    // Which commit a branch should be compared against is `code-infra baseline`'s question, and the
    // harness scripts pass the answer in. Unbound, the previous commit is the only choice here that
    // needs no policy of its own.
    const { repoRoot, shas } = await makeRepo();

    const ref = await resolveBaselineRef(undefined, repoRoot);

    expect(ref.sha).toBe(shas[1]);
  });

  it('keeps the revision it was given, without the scheme', async () => {
    const { repoRoot } = await makeRepo();

    // The report shows this, so a tag stays a tag rather than becoming the SHA it points at.
    expect((await resolveBaselineRef('v1.0.0', repoRoot)).requested).toBe('v1.0.0');
    expect((await resolveBaselineRef('git:v1.0.0', repoRoot)).requested).toBe('v1.0.0');
  });

  it('names a revision and a tag the same build, so the commit is built once', async () => {
    const { repoRoot, shas } = await makeRepo();

    const viaTag = await resolveBaselineRef('v1.0.0', repoRoot);
    const viaSha = await resolveBaselineRef(shas[0], repoRoot);

    // `id` is the build directory: two ids for one commit means packing and building it twice.
    expect(viaTag.id).toBe(viaSha.id);
  });

  it.each(['github:owner/repo#abc1234', 'preview:abc1234'])(
    'reports %s as recognised but not implemented',
    async (token) => {
      const { repoRoot } = await makeRepo();

      await expect(() => resolveBaselineRef(token, repoRoot)).rejects.toThrow(
        /recognised but not implemented/,
      );
    },
  );

  it('rejects the git scheme with no revision after it', async () => {
    const { repoRoot } = await makeRepo();

    await expect(() => resolveBaselineRef('git:', repoRoot)).rejects.toThrow(/names no revision/);
  });

  it('reports what git said about a revision it cannot resolve', async () => {
    const { repoRoot } = await makeRepo();

    // Git is the authority on what a revision is, so an unknown one surfaces as its own failure
    // rather than as a grammar this code would have to keep in step with git's.
    await expect(() => resolveBaselineRef('no-such-thing', repoRoot)).rejects.toThrow(
      /Could not resolve git ref "no-such-thing"/,
    );
  });
});
