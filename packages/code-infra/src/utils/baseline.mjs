import { execa } from 'execa';

/**
 * Resolving "which commit should this branch be compared against".
 *
 * CI jobs that compare a pull request against its base — bundle size, benchmarks — each used to
 * spell this out in shell, and the copies drifted: some fell back to `HEAD~1` on the base branch,
 * some skipped the comparison entirely, and all of them hardcoded `origin`.
 */

const REMOTES_PREFIX = 'refs/remotes/';

/**
 * `origin/release/7.x` → `release/7.x`.
 *
 * Only the remote name comes off, so a branch whose own name contains a slash keeps it. Splitting on
 * the last slash instead would turn `release/7.x` into `7.x` and match nothing.
 * @param {string} shortRef
 * @returns {string}
 */
function branchNameOf(shortRef) {
  const slash = shortRef.indexOf('/');
  return slash === -1 ? shortRef : shortRef.slice(slash + 1);
}

/**
 * Runs a git command, throwing on a non-zero exit.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function gitCapture(args, cwd) {
  const result = await execa('git', args, { cwd, reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
}

/**
 * The branch pull requests fork from, read from `origin`'s default branch and falling back to
 * `master` when the repository has no `origin/HEAD` — which is common in a CI clone.
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function detectBaseBranch(cwd) {
  const result = await execa('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd,
    reject: false,
  });
  if (result.exitCode !== 0) {
    return 'master';
  }
  return branchNameOf(result.stdout.trim());
}

/**
 * Among the available base branches — every remote's `<remote>/<base>` plus a local `<base>` — the
 * one whose merge base with HEAD is the most recent commit (the closest fork point), or undefined
 * if none exist.
 *
 * Picking by most-recent merge base prefers an up-to-date upstream over a stale fork's base branch
 * without hardcoding which remote is authoritative: locally `origin` may be a months-behind fork
 * while `upstream` tracks the real repo, yet in CI `origin` *is* that repo.
 * @param {string} repoRoot
 * @param {string} baseBranch
 * @returns {Promise<{ ref: string, mergeBase: string } | undefined>}
 */
export async function closestBaseBranch(repoRoot, baseBranch) {
  // On ties (same merge base), prefer upstream's, then origin's, then a local base branch.
  const preference = [`upstream/${baseBranch}`, `origin/${baseBranch}`, baseBranch];
  /** @param {string} ref */
  const priority = (ref) => {
    const index = preference.indexOf(ref);
    return index === -1 ? preference.length : index;
  };
  // Match only real base branches from full refnames: a remote's `<remote>/<base>` (exactly one
  // segment before it) or the local `<base>`. Filtering short names on `/<base>` would also catch a
  // local branch literally named e.g. `wip/master`.
  //
  // Compared as a string rather than through a regex built from `baseBranch`: the branch name is
  // arbitrary, and a real one like `v6.x` would make `.` match any character — quietly admitting
  // `origin/v6-x` as a baseline candidate.
  /** @param {string} refname */
  const isRemoteBase = (refname) => {
    if (!refname.startsWith(REMOTES_PREFIX)) {
      return false;
    }
    const withoutPrefix = refname.slice(REMOTES_PREFIX.length);
    // A remote-tracking refname always has a remote to strip; `refs/remotes/foo` alone is not one.
    return withoutPrefix.includes('/') && branchNameOf(withoutPrefix) === baseBranch;
  };

  const candidates = (
    await gitCapture(
      ['for-each-ref', '--format=%(refname)', 'refs/remotes', 'refs/heads'],
      repoRoot,
    )
  )
    .split('\n')
    .filter((ref) => isRemoteBase(ref) || ref === `refs/heads/${baseBranch}`)
    .map((ref) => ref.replace(/^refs\/(remotes|heads)\//, ''))
    .sort((a, b) => priority(a) - priority(b));

  /** @type {{ ref: string, mergeBase: string, when: number } | undefined} */
  let best;
  for (const ref of candidates) {
    // Sequential on purpose: each iteration is a git process, and the list is a handful of refs.
    // eslint-disable-next-line no-await-in-loop
    const result = await execa('git', ['merge-base', 'HEAD', ref], {
      cwd: repoRoot,
      reject: false,
    });
    if (result.exitCode !== 0) {
      continue;
    }
    const mergeBase = result.stdout.trim();
    // eslint-disable-next-line no-await-in-loop
    const when = Number(await gitCapture(['show', '-s', '--format=%ct', mergeBase], repoRoot));
    // Strictly greater, so on ties the higher-priority (earlier-sorted) ref wins.
    if (!best || when > best.when) {
      best = { ref, mergeBase, when };
    }
  }
  return best && { ref: best.ref, mergeBase: best.mergeBase };
}

/**
 * @typedef {Object} Baseline
 * @property {string} sha - The commit to compare against.
 * @property {string} reason - How it was chosen, for a log line.
 */

/**
 * The commit HEAD should be compared against: on a feature branch the fork point from the closest
 * base branch, so a comparison reflects only what the branch changed; on the base branch itself the
 * previous commit, since there is no meaningful fork point there.
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.baseBranch] - Overrides detection from `origin/HEAD`.
 * @returns {Promise<Baseline>}
 */
export async function resolveBaseline(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await gitCapture(['rev-parse', '--show-toplevel'], cwd);
  const baseBranch = options.baseBranch ?? (await detectBaseBranch(repoRoot));

  const previous = async () => ({
    sha: await gitCapture(['rev-parse', 'HEAD~1'], repoRoot),
    reason: 'previous commit',
  });

  if ((await gitCapture(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)) === baseBranch) {
    return previous();
  }

  const base = await closestBaseBranch(repoRoot, baseBranch);
  if (!base) {
    return previous();
  }
  // The fork point is HEAD itself — HEAD is already contained in the base branch, so there is
  // nothing this branch changed to compare.
  if (base.mergeBase === (await gitCapture(['rev-parse', 'HEAD'], repoRoot))) {
    return previous();
  }
  return { sha: base.mergeBase, reason: `merge base with ${base.ref}` };
}
