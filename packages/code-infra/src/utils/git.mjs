import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * @typedef {Object} RepoInfo
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {string} remoteName - Remote name
 */

/**
 * The remote of the canonical repository, as opposed to a fork: `upstream`, else `origin`.
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<string>}
 */
async function getCanonicalRemote(cwd = process.cwd()) {
  const { stdout } = await $({ cwd })`git remote`;
  const remotes = stdout.split('\n');
  const remote = ['upstream', 'origin'].find((name) => remotes.includes(name));
  if (!remote) {
    throw new Error('No canonical remote: this repository has neither `upstream` nor `origin`.');
  }
  return remote;
}

/**
 * The GitHub repository of the canonical remote (see {@link getCanonicalRemote}).
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<RepoInfo>}
 */
export async function getRepositoryInfo(cwd = process.cwd()) {
  const remoteName = await getCanonicalRemote(cwd);
  const { stdout } = await $({ cwd })`git remote get-url ${remoteName}`;
  const url = stdout.trim();
  const parsed = gitUrlParse(url);
  if (parsed.source !== 'github.com') {
    throw new Error(`Remote "${remoteName}" is not a GitHub repository: ${url}`);
  }
  return { owner: parsed.owner, repo: parsed.name, remoteName };
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
 * @param {string} [options.remote] - Defaults to the canonical remote.
 * @param {string} [options.baseBranch] - Defaults to the remote's default branch.
 * @returns {Promise<string>}
 */
export async function resolveBaseline(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const remote = options.remote ?? (await getCanonicalRemote(cwd));
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
    // --force to update any existing tags that may have changed to avoid the clobering error.
    await $$`git fetch --tags --force ${await getCanonicalRemote(opts.cwd)}`;
  }
  const { stdout } = await $$`git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
  return stdout.trim();
}
