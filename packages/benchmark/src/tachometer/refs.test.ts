import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { makeTempDir } from '../utils/testUtils';
import { createRefResolver, parseRefToken } from './refs';

describe('parseRefToken', () => {
  it('treats an absent ref as the working tree', () => {
    expect(parseRefToken(undefined)).toEqual({ kind: 'worktree' });
  });

  it('treats an empty ref as the working tree', () => {
    expect(parseRefToken('')).toEqual({ kind: 'worktree' });
  });

  it('recognises the baseline symbol', () => {
    expect(parseRefToken('baseline')).toEqual({ kind: 'baseline' });
  });

  it('parses a git revision', () => {
    expect(parseRefToken('git:abc1234')).toEqual({ kind: 'git', committish: 'abc1234' });
  });

  it('keeps the whole revision, including characters that look like a scheme', () => {
    expect(parseRefToken('git:origin/master')).toEqual({
      kind: 'git',
      committish: 'origin/master',
    });
  });

  describe('reserved schemes', () => {
    it.each(['github:owner/repo#abc1234', 'preview:abc1234'])(
      'reports %s as recognised but not implemented',
      (token) => {
        expect(() => parseRefToken(token)).toThrow(/recognised but not implemented/);
      },
    );
  });

  describe('unknown tokens', () => {
    it('suggests the git scheme for a bare revision-shaped value', () => {
      expect(() => parseRefToken('HEAD~1')).toThrow(/did you mean "git:HEAD~1"\?/);
    });

    it('does not suggest the git scheme for a value that cannot be a revision', () => {
      // A bare value is never auto-prefixed, since an absent ref already means "working tree".
      expect(() => parseRefToken('what is this')).toThrow(/Unknown ref "what is this"/);
      expect(() => parseRefToken('what is this')).not.toThrow(/did you mean/);
    });
  });
});

/**
 * A repository with three commits on `main`, the first of them carrying an annotated tag.
 *
 * A real repository rather than a stand-in for git: every behaviour here is a question about what
 * git reports — what a tag resolves to, which refnames exist — and a fake would only restate the
 * answer the code already assumes.
 */
async function makeRepo(): Promise<{
  repoRoot: string;
  shas: string[];
  git: (...args: string[]) => Promise<unknown>;
}> {
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

  return { repoRoot, shas, git };
}

describe('createRefResolver', () => {
  it('resolves an annotated tag to the commit it points at', async () => {
    const { repoRoot, shas } = await makeRepo();

    const ref = createRefResolver({ repoRoot }).parse('git:v1.0.0');

    // Without `^{commit}` this is the tag object's own SHA, which is not a commit at all.
    expect(ref.sha).toBe(shas[0]);
  });

  it('gives a tag and its commit one identity, so the commit is built once', async () => {
    const { repoRoot, shas } = await makeRepo();
    const resolver = createRefResolver({ repoRoot });

    const viaTag = resolver.parse('git:v1.0.0');
    const viaSha = resolver.parse(`git:${shas[0]}`);

    // `id` is the build directory and the dedupe key: two ids means packing and building twice.
    expect(viaTag.id).toBe(viaSha.id);
  });

  it('falls back to the previous commit when nothing binds the baseline', async () => {
    // Which commit a branch should be compared against is `code-infra baseline`'s question, and the
    // harness scripts pass the answer in. Unbound, the previous commit is the only choice here that
    // needs no policy of its own.
    const { repoRoot, shas } = await makeRepo();

    const ref = createRefResolver({ repoRoot }).parse('baseline');

    expect(ref.sha).toBe(shas[1]);
  });

  it('labels a git ref with the revision it was given', async () => {
    const { repoRoot } = await makeRepo();

    const ref = createRefResolver({ repoRoot }).parse('git:v1.0.0');

    // Not `v1.0.0 (<sha>)`: `id` already carries the short SHA, and the renderers print both.
    expect(ref.label).toBe('v1.0.0');
  });
});
