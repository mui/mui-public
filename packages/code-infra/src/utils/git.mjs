import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * @typedef {Object} RepoInfo
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {string} remoteName - Remote name
 */

/**
 * Get current repository info from git remote.
 *
 * Reads each remote's configured URL, which `url.<base>.insteadOf` does not rewrite.
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<RepoInfo>} Repository owner and name
 */
export async function getRepositoryInfo(cwd = process.cwd()) {
  /**
   * @type {Record<string, string>}
   */
  const cause = {};
  // Exits 1 when no remote is configured; the error below reports that.
  const { stdout } = await $({
    cwd,
    reject: false,
  })`git config --get-regexp ${'^remote\\..*\\.url$'}`;
  /**
   * @type {Set<string>}
   */
  const repoRemotes = new Set();
  /**
   * @type {Map<string, { owner: string, repo: string }>}
   */
  const validRemotes = new Map();

  for (const line of stdout.split('\n').filter(Boolean)) {
    // "remote.<name>.url <url>"; a remote name may itself contain dots.
    const [key, url] = line.split(' ', 2);
    const remoteName = key.slice('remote.'.length, -'.url'.length);
    repoRemotes.add(remoteName);
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

/**
 * The default branch of `remote`, as the remote itself reports it.
 * @param {string} remote
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function defaultBranchOf(remote, cwd) {
  const { stdout } = await $({ cwd })`git ls-remote --symref ${remote} HEAD`;
  const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(stdout);
  if (!match) {
    throw new Error(`Remote "${remote}" does not report a default branch.`);
  }
  return match[1];
}

/**
 * The commit HEAD should be compared against: where it forked from the base branch, or its parent
 * when HEAD is already on the base branch.
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.baseBranch] - Defaults to the mui remote's default branch.
 * @returns {Promise<string>}
 */
export async function resolveBaseline(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const { remoteName: remote } = await getRepositoryInfo(cwd);
  const baseBranch = options.baseBranch ?? (await defaultBranchOf(remote, cwd));

  await $({ cwd })`git fetch --no-tags ${remote} ${baseBranch}`;
  const [forkPoint, head] = await Promise.all([
    $({ cwd })`git merge-base HEAD FETCH_HEAD`.then((result) => result.stdout.trim()),
    getCurrentGitSha(cwd),
  ]);
  if (forkPoint !== head) {
    return forkPoint;
  }

  const parent = await $({ cwd, reject: false })`git rev-parse --verify HEAD~1`;
  if (parent.exitCode !== 0) {
    throw new Error(
      'HEAD has no parent commit to compare against. A shallow clone is the usual cause.',
    );
  }
  return parent.stdout.trim();
}

/**
 * The most recent version tag reachable from HEAD — where a changelog's range starts.
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
