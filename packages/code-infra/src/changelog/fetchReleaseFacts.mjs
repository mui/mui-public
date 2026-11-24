import * as fs from 'node:fs/promises';
import * as semver from 'semver';

import { getCurrentGitSha, getRepositoryInfo } from '../utils/git.mjs';
import { createOctokit } from './octokit.mjs';
import { fetchReleaseChanges } from './releaseChanges.mjs';
import { comparePackages, readManifests } from './releasePackages.mjs';
import { findCheckout, openCommit, openWorkingTree } from './releaseFiles.mjs';
import { findPreviousVersionTag } from './releaseTags.mjs';

/**
 * @typedef {import('./types.ts').FetchReleaseFactsOptions} FetchReleaseFactsOptions
 * @typedef {import('./types.ts').GitHubRepository} GitHubRepository
 * @typedef {import('./types.ts').ReleaseFacts} ReleaseFacts
 */

/**
 * Collects what happened in a release: its changes and its packages. Run inside a checkout of the
 * repository, every option is optional.
 *
 * @param {FetchReleaseFactsOptions} [options]
 * @returns {Promise<ReleaseFacts>}
 */
export async function fetchReleaseFacts(options = {}) {
  const controller = new AbortController();
  try {
    return await collectFacts(options, controller);
  } catch (error) {
    // Cancels what is still in flight. The first failure is the reason, not the cancellations
    // that follow from it.
    controller.abort(error);
    throw controller.signal.reason;
  }
}

/**
 * @param {FetchReleaseFactsOptions} options
 * @param {AbortController} controller
 * @returns {Promise<ReleaseFacts>}
 */
async function collectFacts(options, controller) {
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
        `HEAD (${releaseRef}) is not on GitHub in ${repository.owner}/${repository.name}. ` +
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

  const changes = await fetchReleaseChanges({
    octokit,
    repository,
    previousSha,
    releaseSha,
    includeDirectCommits: options.includeDirectCommits ?? false,
    controller,
  });

  // Without a local HEAD or a remote, nothing says that the checkout is one of the repository.
  const checkout = isLocalHead || remote ? await findCheckout(cwd) : null;
  const context = { octokit, repository, checkout, signal };
  const [manifests, previousManifests] = await Promise.all([
    readManifests(
      isLocalHead && checkout
        ? await openWorkingTree(checkout.root)
        : await openCommit({ ...context, sha: releaseSha }),
    ),
    readManifests(await openCommit({ ...context, sha: previousSha })),
  ]);

  const taggedVersion = isLocalHead ? null : semver.valid(releaseRef);
  const version =
    options.version ??
    taggedVersion ??
    manifests.find((manifest) => manifest.path === '.')?.version;
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
    packages: comparePackages(manifests, previousManifests),
  };
}

/**
 * The repository, and the remote of the checkout that points at it, if any.
 *
 * @param {string} cwd
 * @param {FetchReleaseFactsOptions} options
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
  const name = options.repo ?? /** @type {NonNullable<typeof info>} */ (info).repo;
  const isCheckout = info?.owner === owner && info.repo === name;
  return { repository: { owner, name }, remote: isCheckout ? info.remoteName : null };
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
    owner: repository.owner,
    repo: repository.name,
    ref,
    // Limits the file list, which can be large and isn't needed.
    per_page: 1,
    request: { signal },
  });
  return data;
}
