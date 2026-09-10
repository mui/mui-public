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

/** Runs a git command, throwing on a non-zero exit. */
function gitCapture(args: string[], cwd: string): string {
  const result = execaSync('git', args, { cwd, reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Creates a resolver that turns {@link RefDescriptor}s into {@link ResolvedRef}s, memoizing the
 * `baseline` symbol so it is computed at most once per run.
 */
export function createRefResolver(options: RefResolverOptions): {
  parse: (token?: string) => ResolvedRef;
} {
  const { repoRoot, baselineOverride } = options;

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
   * Computes the `baseline` symbol from whatever bound it.
   *
   * Which commit that should be is not decided here: `code-infra baseline` answers that for every
   * job that compares against a base — bundle size as well as benchmarks — so the harness scripts
   * pass the answer in rather than each tool having its own opinion of a fork point. Without a
   * binding the previous commit is the only choice that needs no policy.
   */
  function computeBaselineRef(): ResolvedRef {
    if (baselineOverride === undefined) {
      return gitRef('HEAD~1');
    }
    const descriptor = parseRefToken(baselineOverride);
    if (descriptor.kind === 'baseline') {
      throw new Error('The baseline cannot itself be "baseline" — that is the symbol it binds.');
    }
    return resolve(descriptor);
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
