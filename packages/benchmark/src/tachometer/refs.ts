import chalk from 'chalk';
import { execaSync } from 'execa';
import { revParseCommitArgs } from '../utils/git';

/**
 * The `?ref=` grammar: which build of the workspace a benchmark page should load.
 *
 * A ref always denotes a commit and covers every package in the workspace. Parsing is split in two
 * so that consumers who only need to know *which pages exist* never shell out to git:
 *
 * - {@link parseRefToken} validates the grammar and returns a descriptor. Pure.
 * - {@link createRefResolver} turns a descriptor into a {@link ResolvedRef} with an immutable SHA.
 */

/** Only a `git:` ref carries a revision, which the union states rather than leaving to a comment. */
export type RefDescriptor =
  { kind: 'worktree' } | { kind: 'baseline' } | { kind: 'git'; committish: string };

interface RefIdentity {
  /** Build directory name, e.g. `current` or `git-230342ee2`. Doubles as the dedupe identity. */
  id: string;
  /** Human-readable label for logs and the report. */
  label: string;
}

/**
 * A ref with its build identity. The working tree has no commit behind it and a `git:` ref always
 * does, so the two carry different fields rather than sharing optional ones a reader has to pair
 * with the right `kind` by hand.
 */
export type ResolvedRef =
  | (RefIdentity & { kind: 'worktree'; sha?: undefined; committish?: undefined })
  | (RefIdentity & { kind: 'git'; sha: string; committish: string });

export interface RefResolverOptions {
  /** Repository to resolve revisions in. */
  repoRoot: string;
  /** Branch PRs fork from. Defaults to detection via `origin/HEAD`, then `master`. */
  baseBranch?: string;
  /** Binds the `baseline` symbol, in the ref grammar (e.g. `git:abc1234`). */
  baselineOverride?: string;
}

/** The working tree — never cached, since it has no immutable identity. */
const WORKTREE_REF: ResolvedRef = {
  kind: 'worktree',
  id: 'current',
  label: 'working tree',
};

/**
 * Parses a `?ref=` token into a descriptor, validating the grammar. Makes no git calls.
 *
 * Bare values are never auto-prefixed: an absent ref already means "working tree", so letting a
 * bare value mean a git revision would give one token two meanings depending on where it appears.
 */
export function parseRefToken(token?: string): RefDescriptor {
  if (token === undefined || token === '') {
    return { kind: 'worktree' };
  }

  if (token === 'baseline') {
    return { kind: 'baseline' };
  }

  if (token.startsWith('git:') && token.length > 'git:'.length) {
    return { kind: 'git', committish: token.slice('git:'.length) };
  }

  if (token.startsWith('github:') || token.startsWith('preview:')) {
    const scheme = token.split(':', 1)[0];
    throw new Error(
      `Ref scheme "${scheme}:" is recognised but not implemented yet (in "${token}"). ` +
        `Supported today: an absent ref (working tree), "baseline", and "git:<rev>".`,
    );
  }

  // Only advertise the schemes that actually work here; the reserved `github:`/`preview:` schemes
  // are handled above with their own message, so listing them as valid would mislead.
  throw new Error(
    `Unknown ref "${token}". Expected an absent ref (working tree), "baseline", or "git:<rev>"` +
      `${/^[0-9a-zA-Z._/~^-]+$/.test(token) ? ` — did you mean "git:${token}"?` : '.'}`,
  );
}

/** Refname prefix every remote-tracking branch carries. */
const REMOTES_PREFIX = 'refs/remotes/';

/** Runs a git command, throwing on a non-zero exit. */
function gitCapture(args: string[], cwd: string): string {
  const result = execaSync('git', args, { cwd, reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
}

/** Detects the branch PRs fork from, from `origin`'s default branch, falling back to `master`. */
function detectBaseBranch(cwd: string): string {
  const result = execaSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd,
    reject: false,
  });
  if (result.exitCode !== 0) {
    return 'master';
  }
  // `origin/main` → `main`. Everything after the remote name is the branch name, so a default
  // branch like `release/7.x` keeps its slash.
  const shortRef = result.stdout.trim();
  const slash = shortRef.indexOf('/');
  return slash === -1 ? shortRef : shortRef.slice(slash + 1);
}

/**
 * Among the available base branches — every remote's `<remote>/<base>` plus a local `<base>` —
 * returns the one whose merge base with HEAD is the most recent commit (the closest fork point), or
 * undefined if none exist.
 *
 * Picking by most-recent merge base prefers an up-to-date upstream over a stale fork's base branch
 * without hardcoding which remote is authoritative: locally `origin` may be a months-behind fork
 * while `upstream` tracks the real repo, yet in CI `origin` *is* that repo.
 */
function closestBaseBranch(
  repoRoot: string,
  baseBranch: string,
): { ref: string; mergeBase: string } | undefined {
  // On ties (same merge base), prefer upstream's, then origin's, then a local base branch.
  const preference = [`upstream/${baseBranch}`, `origin/${baseBranch}`, baseBranch];
  const priority = (ref: string): number => {
    const index = preference.indexOf(ref);
    return index === -1 ? preference.length : index;
  };
  // Match only real base branches from full refnames: a remote's `<remote>/<base>` (exactly one
  // segment before it) or the local `<base>`. Filtering short names on `/<base>` would also catch a
  // local branch literally named e.g. `wip/master`.
  //
  // Compared segment by segment rather than by a regex built from `baseBranch`: the branch name is
  // arbitrary, and a real one like `v6.x` would make `.` match any character — quietly admitting
  // `origin/v6-x` as a baseline candidate.
  const isRemoteBase = (refname: string): boolean => {
    const tail = refname.startsWith(REMOTES_PREFIX) ? refname.slice(REMOTES_PREFIX.length) : '';
    const slash = tail.indexOf('/');
    return slash !== -1 && tail.slice(slash + 1) === baseBranch;
  };
  const candidates = gitCapture(
    ['for-each-ref', '--format=%(refname)', 'refs/remotes', 'refs/heads'],
    repoRoot,
  )
    .split('\n')
    .filter((ref) => isRemoteBase(ref) || ref === `refs/heads/${baseBranch}`)
    .map((ref) => ref.replace(/^refs\/(remotes|heads)\//, ''))
    .sort((a, b) => priority(a) - priority(b));

  let best: { ref: string; mergeBase: string; when: number } | undefined;
  for (const ref of candidates) {
    const result = execaSync('git', ['merge-base', 'HEAD', ref], { cwd: repoRoot, reject: false });
    if (result.exitCode !== 0) {
      continue;
    }
    const mergeBase = result.stdout.trim();
    const when = Number(gitCapture(['show', '-s', '--format=%ct', mergeBase], repoRoot));
    // Strictly greater, so on ties the higher-priority (earlier-sorted) ref keeps a clean label.
    if (!best || when > best.when) {
      best = { ref, mergeBase, when };
    }
  }
  return best && { ref: best.ref, mergeBase: best.mergeBase };
}

/**
 * Creates a resolver that turns {@link RefDescriptor}s into {@link ResolvedRef}s, memoizing the
 * `baseline` symbol so it is computed at most once per run.
 */
export function createRefResolver(options: RefResolverOptions): {
  parse: (token?: string) => ResolvedRef;
} {
  const { repoRoot, baselineOverride } = options;
  // Detected on demand: only the `baseline` symbol needs it, so a run whose cases all pin `git:`
  // refs — or none at all — never shells out for it.
  let baseBranch = options.baseBranch;

  let baselineRef: ResolvedRef | undefined;
  // Several cases commonly pin the same commit, and resolving one spawns a git process.
  const gitRefs = new Map<string, ResolvedRef>();

  /** Resolves a git committish to a `ResolvedRef` keyed by its immutable SHA. */
  function gitRef(committish: string, label?: string): ResolvedRef {
    const cached = gitRefs.get(committish);
    if (cached) {
      return cached;
    }
    const sha = gitCapture(revParseCommitArgs(committish), repoRoot);
    const ref: ResolvedRef = {
      kind: 'git',
      id: `git-${sha.slice(0, 9)}`,
      label: label ?? committish,
      sha,
      committish: sha,
    };
    gitRefs.set(committish, ref);
    return ref;
  }

  /**
   * Computes the `baseline` symbol: the override when given, otherwise the sensible default — on
   * the base branch the previous commit, on any other branch the fork point from the closest base
   * branch, which isolates what this branch changed.
   */
  function computeBaselineRef(): ResolvedRef {
    if (baselineOverride !== undefined) {
      const descriptor = parseRefToken(baselineOverride);
      if (descriptor.kind === 'baseline') {
        throw new Error('The baseline cannot itself be "baseline" — that is the symbol it binds.');
      }
      return resolve(descriptor);
    }

    baseBranch ??= detectBaseBranch(repoRoot);

    if (gitCapture(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) === baseBranch) {
      return gitRef('HEAD~1');
    }

    const base = closestBaseBranch(repoRoot, baseBranch);
    if (!base) {
      console.warn(chalk.yellow(`No ${baseBranch} branch found; using HEAD~1 as the baseline.`));
      return gitRef('HEAD~1');
    }
    // Fork point is HEAD itself (HEAD already contained in the base branch) — nothing to diff.
    if (base.mergeBase === gitCapture(['rev-parse', 'HEAD'], repoRoot)) {
      return gitRef('HEAD~1');
    }
    return gitRef(base.mergeBase, `merge-base with ${base.ref}`);
  }

  function resolve(descriptor: RefDescriptor): ResolvedRef {
    if (descriptor.kind === 'worktree') {
      return WORKTREE_REF;
    }
    if (descriptor.kind === 'baseline') {
      baselineRef ??= computeBaselineRef();
      return baselineRef;
    }
    // The union has no fourth member, so this is the `git:` case and carries a revision.
    return gitRef(descriptor.committish);
  }

  return {
    parse: (token?: string) => resolve(parseRefToken(token)),
  };
}
