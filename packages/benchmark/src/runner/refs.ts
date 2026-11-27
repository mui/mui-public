import { resolveCommit } from '../utils/git';

/**
 * A build a run measures: the working tree (`current`), or the revision it is compared against
 * (`baseline`). `variant` names its pages, its build directory and its entry in the report.
 * `requested` is the revision as it was given, which is what a report shows.
 */
export type ResolvedRef =
  | { variant: 'current'; sha?: undefined; requested?: undefined }
  | { variant: 'baseline'; sha: string; requested: string };

/** What a ref is called in a report: the working tree, or the revision the run was given. */
export function refLabel(ref: ResolvedRef): string {
  return ref.variant === 'current' ? 'working tree' : ref.requested;
}

export const WORKTREE_REF: ResolvedRef = { variant: 'current' };

/** The revision a baseline token names: a bare revision, or one prefixed with `git:`. */
function committishOf(token: string | undefined): string {
  if (!token) {
    // `code-infra baseline` answers which commit a pull request compares against; without it, the
    // previous commit is the only choice that needs no policy.
    return 'HEAD~1';
  }
  if (token.startsWith('git:')) {
    const revision = token.slice('git:'.length);
    if (!revision) {
      throw new Error('The baseline "git:" names no revision.');
    }
    return revision;
  }
  return token;
}

/**
 * The baseline token that leaves the baseline out: a run of `compare()`s only measures the working
 * tree, so building another revision would be wasted. `git:none` still names a revision.
 */
export const NO_BASELINE = 'none';

/** Resolves the baseline to the commit behind it, so a run stays interpretable after the fact. */
export async function resolveBaselineRef(
  token: string | undefined,
  repoRoot: string,
): Promise<ResolvedRef> {
  const committish = committishOf(token);
  const sha = await resolveCommit(repoRoot, committish);
  return { variant: 'baseline', sha, requested: committish };
}

/**
 * The builds a run measures, the working tree first: it is the reference every comparison is
 * judged from. Without a baseline, that is all there is.
 */
export async function resolveRunRefs(
  token: string | undefined,
  repoRoot: string,
): Promise<ResolvedRef[]> {
  if (token === NO_BASELINE) {
    return [WORKTREE_REF];
  }
  return [WORKTREE_REF, await resolveBaselineRef(token, repoRoot)];
}
