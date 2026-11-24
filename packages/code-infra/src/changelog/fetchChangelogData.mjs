import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as semver from 'semver';

import { getCurrentGitSha, getRepositoryInfo } from '../utils/git.mjs';
import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { createOctokit } from './octokit.mjs';
import { fetchChangelogChanges } from './changelogChanges.mjs';
import { findPreviousVersionTag } from './changelogTags.mjs';

/**
 * @typedef {import('./types.ts').FetchChangelogDataOptions} FetchChangelogDataOptions
 * @typedef {import('./types.ts').GitHubRepository} GitHubRepository
 * @typedef {import('./types.ts').ChangelogData} ChangelogData
 */

/**
 * Collects what happened in a release: its changes and its packages. Run inside a checkout of the
 * repository, every option is optional.
 *
 * @param {FetchChangelogDataOptions} [options]
 * @returns {Promise<ChangelogData>}
 */
export async function fetchChangelogData(options = {}) {
  const controller = new AbortController();
  try {
    return await collectData(options, controller);
  } catch (error) {
    // Cancels what is still in flight. The first failure is the reason, not the cancellations
    // that follow from it.
    controller.abort(error);
    throw controller.signal.reason;
  }
}

/**
 * @param {FetchChangelogDataOptions} options
 * @param {AbortController} controller
 * @returns {Promise<ChangelogData>}
 */
async function collectData(options, controller) {
  const cwd = await fs.realpath(options.cwd ?? process.cwd());
  const octokit = options.octokit ?? createOctokit();
  const { signal } = controller;

  const { repository, remote } = await resolveRepository(cwd, options);
  const isLocalHead = (options.release ?? 'HEAD') === 'HEAD';
  const releaseRef = isLocalHead
    ? await getCurrentGitSha(cwd)
    : /** @type {string} */ (options.release);
  const releaseCommit = await getCommit(octokit, repository, releaseRef, signal).catch((error) => {
    if (isLocalHead && error.status === 422) {
      throw new Error(
        `HEAD (${releaseRef}) is not on GitHub in ${repository.owner}/${repository.repo}. ` +
          'Push it, or pass a `release` ref that is already pushed.',
        { cause: error },
      );
    }
    throw error;
  });
  const releaseSha = releaseCommit.sha;

  const previousRef =
    options.lastRelease ?? (await findPreviousVersionTag({ cwd, remote, sha: releaseSha }));
  const previousSha = (await getCommit(octokit, repository, previousRef, signal)).sha;

  const changes = await fetchChangelogChanges({
    octokit,
    repository,
    previousSha,
    releaseSha,
    includeDirectCommits: options.includeDirectCommits ?? false,
    controller,
  });

  const packages = await readPackages(cwd);
  const taggedVersion = isLocalHead ? null : semver.valid(releaseRef);
  const version =
    options.version ?? taggedVersion ?? packages.find((pkg) => pkg.path === '.')?.version;
  if (!version) {
    throw new Error('The root package.json has no version. Pass the `version` of the release.');
  }

  const date =
    options.date ?? (taggedVersion && releaseCommit.commit.committer?.date) ?? new Date();

  return {
    repository,
    previous: { ref: previousRef, sha: previousSha },
    release: { ref: releaseRef, sha: releaseSha },
    version,
    date: new Date(date).toISOString(),
    changes,
    packages: packages.flatMap(({ name, ...pkg }) => (name === null ? [] : [{ name, ...pkg }])),
  };
}

/**
 * The packages as they are in the working tree, named or not, sorted by path.
 *
 * @param {string} cwd
 */
async function readPackages(cwd) {
  const workspaceDir = await findWorkspaceDir(cwd);
  const root = workspaceDir ?? cwd;
  const packages = await getWorkspacePackages({ cwd: root });
  return (
    packages
      // Without a workspace, pnpm lists the packages of all subdirectories.
      .filter((pkg) => workspaceDir || pkg.path === root)
      .map((pkg) => ({
        name: pkg.name ?? null,
        version: pkg.version ?? null,
        private: pkg.isPrivate,
        path: path.relative(root, pkg.path).split(path.sep).join('/') || '.',
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
  );
}

/**
 * The repository, and the remote of the checkout that points at it, if any.
 *
 * @param {string} cwd
 * @param {FetchChangelogDataOptions} options
 * @returns {Promise<{ repository: GitHubRepository, remote: string | null }>}
 */
async function resolveRepository(cwd, options) {
  const info = await getRepositoryInfo(cwd).catch((error) => {
    if (options.repo) {
      return null;
    }
    throw error;
  });
  const owner = options.org ?? 'mui';
  const repo = options.repo ?? /** @type {NonNullable<typeof info>} */ (info).repo;
  const isCheckout = info?.owner === owner && info.repo === repo;
  return { repository: { owner, repo }, remote: isCheckout ? info.remoteName : null };
}

/**
 * Resolving refs up front keeps a moving branch from shifting the range while it is paginated.
 *
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {GitHubRepository} repository
 * @param {string} ref
 * @param {AbortSignal} signal
 */
async function getCommit(octokit, repository, ref, signal) {
  const { data } = await octokit.repos.getCommit({
    ...repository,
    ref,
    // Limits the file list, which can be large and isn't needed.
    per_page: 1,
    request: { signal },
  });
  return data;
}
