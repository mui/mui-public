import { resolveCommit } from '../utils/git';

/**
 * The builds a run measures: the working tree, and the baseline it is compared against.
 *
 * Those are the only two. A case either compares the working tree against the baseline or compares
 * the pages it names against each other, all built from the working tree — so the only build anyone
 * chooses is the baseline, and `--baseline` is where it is named.
 */

/**
 * A build with its identity. The working tree has no commit behind it and a git revision always
 * does, so the two carry different fields rather than sharing optional ones a reader has to pair
 * with the right `kind` by hand.
 *
 * `id` is the build directory name — `current`, or `git-230342ee2`. `requested` is the revision as
 * it was given, which is what a report shows.
 */
export type ResolvedRef =
  | { kind: 'worktree'; id: string; sha?: undefined; requested?: undefined }
  | { kind: 'git'; id: string; sha: string; requested: string };

/** The working tree, which every run builds. Never cached, having no immutable identity. */
export const WORKTREE_REF: ResolvedRef = { kind: 'worktree', id: 'current' };

/** Schemes a baseline may eventually name, each rejected until it does something. */
const RESERVED_SCHEMES = ['github', 'preview'];

/**
 * The revision a baseline token names.
 *
 * A bare value is a revision and `git:` says so explicitly, which leaves room for a baseline that is
 * not a commit in this repository — a published preview, another repository — to arrive as its own
 * scheme without the flag changing shape. Anything else goes to git, which is the authority on what
 * a revision is.
 */
function committishOf(token: string | undefined): string {
  if (!token) {
    // Which commit a pull request should be measured against is not decided here: `code-infra
    // baseline` answers that for every job that compares against a base — bundle size as well as
    // benchmarks — and the harness scripts pass the answer in. Without one, the previous commit is
    // the only choice that needs no policy.
    return 'HEAD~1';
  }
  if (token.startsWith('git:')) {
    const revision = token.slice('git:'.length);
    if (!revision) {
      throw new Error('The baseline "git:" names no revision.');
    }
    return revision;
  }
  const reserved = RESERVED_SCHEMES.find((scheme) => token.startsWith(`${scheme}:`));
  if (reserved) {
    throw new Error(
      `Baseline scheme "${reserved}:" is recognised but not implemented yet (in "${token}"). ` +
        `Pass a git revision, on its own or as "git:<rev>".`,
    );
  }
  return token;
}

/** Resolves the baseline to the commit behind it, so a run stays interpretable after the fact. */
export async function resolveBaseline(
  token: string | undefined,
  repoRoot: string,
): Promise<ResolvedRef> {
  const committish = committishOf(token);
  const sha = await resolveCommit(repoRoot, committish);
  return { kind: 'git', id: `git-${sha.slice(0, 9)}`, sha, requested: committish };
}
