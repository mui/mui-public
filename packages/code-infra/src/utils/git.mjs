import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * @typedef {Object} RepoInfo
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {string} remoteName - Remote name
 */

/**
 * Get current repository info from git remote
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<RepoInfo>} Repository owner and name
 */
export async function getRepositoryInfo(cwd = process.cwd()) {
  /**
   * @type {Record<string, string>}
   */
  const cause = {};
  const { stdout } = await $({ cwd })`git remote -v`;
  const lines = stdout.trim().split('\n');
  /**
   * @type {Set<string>}
   */
  const repoRemotes = new Set();
  /**
   * @type {Map<string, { owner: string, repo: string }>}
   */
  const validRemotes = new Map();

  for (const line of lines) {
    // Match pattern: "remoteName url (fetch|push)"
    const [remoteName, url, type] = line.trim().split(/\s+/, 3);
    repoRemotes.add(remoteName);
    if (type === '(fetch)') {
      try {
        const parsed = gitUrlParse(url);
        if (parsed.source !== 'github.com' || parsed.owner !== 'mui') {
          cause[remoteName] = `Remote is not a GitHub repository under 'mui' organization: ${url}`;
          continue;
        }
        if (!validRemotes.has(remoteName)) {
          validRemotes.set(remoteName, { owner: parsed.owner, repo: parsed.name });
        }
      } catch (error) {
        cause[remoteName] = `Failed to parse URL for remote ${remoteName}: ${url}`;
      }
    } else if (type !== '(push)') {
      throw new Error(`Unexpected line format for "git remote -v": "${line}"`);
    }
  }

  const preferredOrder = ['upstream', 'origin', ...validRemotes.keys()];
  for (const name of preferredOrder) {
    const match = validRemotes.get(name);
    if (match) {
      return { ...match, remoteName: name };
    }
  }

  throw new Error(
    `Failed to find correct remote(s) in : ${Array.from(repoRemotes.keys()).join(', ')}`,
    { cause },
  );
}

/**
 * Get current git SHA
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<string>} Current git commit SHA
 */
export async function getCurrentGitSha(cwd = process.cwd()) {
  const result = await $({ cwd })`git rev-parse HEAD`;
  return result.stdout.trim();
}

/**
 * Check whether a tag already exists on the origin remote
 * @param {string} tagName - Tag name to check (e.g. `v1.2.3`)
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<boolean>} True if the tag exists on origin
 */
export async function remoteGitTagExists(tagName, cwd = process.cwd()) {
  const { stdout } = await $({ cwd })`git ls-remote --tags origin refs/tags/${tagName}`;
  return stdout.trim().length > 0;
}

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
 * The branch pull requests fork from, from `<remote>/HEAD` — the only local record of a remote's
 * default branch, and often absent: only `git clone` writes one, and only for `origin`.
 *
 * Throws rather than guessing a conventional name, which resolves to no ref in
 * {@link closestBaseBranch} and leaves the baseline as the previous commit.
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<string>}
 */
export async function detectBaseBranch(cwd = process.cwd()) {
  const listed = (await $({ cwd })`git remote`).stdout.trim().split('\n').filter(Boolean);
  // `origin` first: it is the one a clone records a HEAD for.
  const remotes = [...new Set(['origin', ...listed])].filter((remote) => listed.includes(remote));

  for (const remote of remotes) {
    // Sequential: a handful of remotes, and the first hit wins.
    // eslint-disable-next-line no-await-in-loop
    const head = await $({
      cwd,
      reject: false,
    })`git symbolic-ref --short ${`refs/remotes/${remote}/HEAD`}`;
    if (head.exitCode === 0) {
      return branchNameOf(head.stdout.trim());
    }
  }

  throw new Error(
    'Could not tell which branch this one forks from: no remote records a default branch. ' +
      'Run `git remote set-head origin -a` to write one, or name the base branch explicitly.',
  );
}

/**
 * Among the available base branches — every remote's `<remote>/<base>` plus a local `<base>` — the
 * one whose merge base with HEAD is the most recent commit (the closest fork point), or undefined
 * if none exist.
 *
 * Picking by most-recent merge base prefers an up-to-date upstream over a stale fork's base branch
 * without hardcoding which remote is authoritative: locally `origin` may be a months-behind fork
 * while `upstream` tracks the real repo, yet in CI `origin` *is* that repo.
 * @param {string} baseBranch
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<{ ref: string, mergeBase: string } | undefined>}
 */
export async function closestBaseBranch(baseBranch, cwd = process.cwd()) {
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

  const { stdout } = await $({
    cwd,
  })`git for-each-ref --format=%(refname) refs/remotes refs/heads`;
  const candidates = stdout
    .trim()
    .split('\n')
    .filter((ref) => isRemoteBase(ref) || ref === `refs/heads/${baseBranch}`)
    .map((ref) => ref.replace(/^refs\/(remotes|heads)\//, ''))
    .sort((a, b) => priority(a) - priority(b));

  /** @type {{ ref: string, mergeBase: string, when: number } | undefined} */
  let best;
  for (const ref of candidates) {
    // Sequential on purpose: each iteration is a git process, and the list is a handful of refs.
    // eslint-disable-next-line no-await-in-loop
    const result = await $({ cwd, reject: false })`git merge-base HEAD ${ref}`;
    if (result.exitCode !== 0) {
      continue;
    }
    const mergeBase = result.stdout.trim();
    // `--no-show-signature` because `log.showSignature` would otherwise prepend verification lines
    // to the output, and the timestamp would read as NaN — which loses every later comparison and
    // leaves whichever candidate came first standing.
    // eslint-disable-next-line no-await-in-loop
    const shown = await $({
      cwd,
      reject: false,
    })`git show -s --no-show-signature --format=%ct ${mergeBase}`;
    const when = Number(shown.stdout.trim());
    if (shown.exitCode !== 0 || !Number.isFinite(when)) {
      continue;
    }
    // Strictly greater, so on ties the higher-priority (earlier-sorted) ref wins.
    if (!best || when > best.when) {
      best = { ref, mergeBase, when };
    }
  }
  return best && { ref: best.ref, mergeBase: best.mergeBase };
}

/**
 * The commit HEAD should be compared against: on a feature branch the fork point from the closest
 * base branch, so a comparison reflects only what the branch changed; on the base branch itself the
 * previous commit, since there is no meaningful fork point there.
 *
 * One answer for every job that compares a branch to its base — bundle size, benchmarks — which
 * each used to derive it in shell, and had drifted apart doing so.
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.baseBranch] - Overrides detection from `origin/HEAD`.
 * @returns {Promise<string>}
 */
export async function resolveBaseline(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const baseBranch = options.baseBranch ?? (await detectBaseBranch(cwd));

  const previousCommit = async () => {
    const result = await $({ cwd, reject: false })`git rev-parse --verify HEAD~1`;
    if (result.exitCode !== 0) {
      throw new Error(
        'HEAD has no parent commit, so there is nothing here to compare against. A shallow clone ' +
          'is the usual cause — fetch more history, or name the base branch explicitly.',
      );
    }
    return result.stdout.trim();
  };

  const branch = (await $({ cwd })`git rev-parse --abbrev-ref HEAD`).stdout.trim();
  if (branch === baseBranch) {
    return previousCommit();
  }

  const base = await closestBaseBranch(baseBranch, cwd);
  if (!base) {
    return previousCommit();
  }
  // The fork point is HEAD itself — HEAD is already contained in the base branch, so there is
  // nothing this branch changed to compare.
  if (base.mergeBase === (await getCurrentGitSha(cwd))) {
    return previousCommit();
  }
  return base.mergeBase;
}

/**
 * The most recent version tag reachable from HEAD — where a changelog's range starts.
 *
 * Not a baseline: {@link resolveBaseline} answers where a *branch* diverged, which on a feature
 * branch is a different commit entirely, and the two are not interchangeable.
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {boolean} [opts.fetchAll=true] Whether to fetch all tags from all remotes before finding the latest tag.
 * @returns {Promise<string>}
 */
export async function findLatestTaggedVersion(opts) {
  const $$ = $({ cwd: opts.cwd });
  const fetchAll = opts.fetchAll ?? true;
  if (fetchAll) {
    const { remoteName } = await getRepositoryInfo(opts.cwd);
    // Fetch all tags from the mui remote to ensure we have the latest tags.
    // --force to update any existing tags that may have changed to avoid the clobering error.
    await $$`git fetch --tags --force ${remoteName}`;
  }
  const { stdout } = await $$`git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
  return stdout.trim();
}
