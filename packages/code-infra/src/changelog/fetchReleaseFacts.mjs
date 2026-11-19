import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { findLatestTaggedVersion, getRepositoryInfo, getCurrentGitSha } from '../utils/git.mjs';
import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';

/**
 * @typedef {import('./types.ts').FetchReleaseFactsOptions} FetchReleaseFactsOptions
 * @typedef {import('./types.ts').ReleaseFacts} ReleaseFacts
 * @typedef {import('./types.ts').ReleaseEntry} ReleaseEntry
 * @typedef {import('./types.ts').ReleasePackage} ReleasePackage
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').DirectCommitDetails} DirectCommitDetails
 */

const HTTP_NOT_FOUND = 404;

/** @type {Record<string, import('./types.ts').ReleaseAssociation>} */
const ASSOCIATIONS = { team: 'team', contributor: 'community', first_timer: 'first-timer' };

/**
 * Fetch and normalize what happened in a release range: entries with resolved authors, and
 * workspace packages with their versions compared against `lastRelease`.
 *
 * @param {FetchReleaseFactsOptions} [options]
 * @returns {Promise<ReleaseFacts>}
 */
export async function fetchReleaseFacts(options = {}) {
  const cwd = await fs.realpath(options.cwd ?? process.cwd());

  const repository = options.repo
    ? { repo: options.repo, owner: options.org ?? 'mui' }
    : await getRepositoryInfo(cwd);

  const owner = options.org ?? repository.owner;
  const releaseRef = options.release || 'HEAD';
  const localHead = releaseRef === 'HEAD';
  const lastRelease = options.lastRelease ?? (await findLatestTaggedVersion({ cwd }));
  const release = localHead ? await getCurrentGitSha(cwd) : releaseRef;

  let commits;

  try {
    commits = await fetchCommitsBetweenRefs({
      repo: repository.repo,
      org: owner,
      lastRelease,
      release,
      octokit: options.octokit,
      cherryPickLabels: options.cherryPickLabels,
      // The overloads only narrow literal flags; the union return type covers both.
      includeDirectCommits: /** @type {true} */ (options.includeDirectCommits === true),
    });
  } catch (error) {
    if (
      localHead &&
      error instanceof Error &&
      'status' in error &&
      error.status === HTTP_NOT_FOUND
    ) {
      throw new Error(
        `GitHub could not compare ${lastRelease} with local HEAD ${release}. Push HEAD or pass --release, and verify the base ref and repository access.`,
        { cause: error },
      );
    }

    throw error;
  }

  const date = options.date ?? new Date();

  return {
    repo: { owner, name: repository.repo },
    lastRelease,
    release,
    version:
      options.version ??
      JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).version,
    date: new Date(date).toISOString(),
    entries: commits.map(toEntry),
    packages: await readPackages(cwd, lastRelease),
  };
}

/**
 * @param {FetchedCommitDetails | DirectCommitDetails} commit
 * @returns {ReleaseEntry}
 */
function toEntry(commit) {
  const subject = commit.message.split('\n')[0].trim();
  const prefix = subject.match(/^(?:\[[^\]\r\n]+\])+/)?.[0] ?? '';
  let title = subject.slice(prefix.length).trimStart();

  if (commit.prNumber !== null) {
    title = title.replace(/\s?\(#\d+\)/g, '');
  }

  const name = 'authorName' in commit ? commit.authorName : undefined;
  /** @type {ReleaseEntry['author']} */
  let author = null;

  if (commit.author) {
    author = { login: commit.author.login, association: ASSOCIATIONS[commit.author.association] };
  } else if (name) {
    author = { login: null, association: 'community' };
  }

  if (author && name) {
    author.name = name;
  }

  return {
    sha: commit.sha,
    pr: commit.prNumber,
    url: commit.html_url,
    title,
    prefixes: [...prefix.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]),
    message: commit.message,
    labels: commit.labels,
    prTitle: commit.prTitle,
    body: commit.prBody,
    author,
    mergedAt: commit.mergedAt,
    createdAt: commit.createdAt,
  };
}

/**
 * Compare manifests, not changed paths: a dependency-only bump still releases a new version.
 * Paths are relative to `cwd`, so a workspace nested in a larger repository compares its own files.
 *
 * @param {string} cwd
 * @param {string} lastRelease
 * @returns {Promise<ReleasePackage[]>}
 */
async function readPackages(cwd, lastRelease) {
  let packages;

  try {
    packages = await getWorkspacePackages({ cwd });
  } catch {
    return [];
  }

  const base = await execa('git', ['rev-parse', '--verify', `${lastRelease}^{commit}`], {
    cwd,
    reject: false,
  });

  const named = packages.flatMap((pkg) => (pkg.name ? [{ ...pkg, name: pkg.name }] : []));
  const ref = base.exitCode === 0 ? lastRelease : null;

  return Promise.all(named.map((pkg) => describePackage(cwd, ref, pkg)));
}

/**
 * @param {string} cwd
 * @param {string | null} lastRelease Null when the ref is not available locally.
 * @param {{ name: string; version?: string; path: string; isPrivate: boolean }} pkg
 * @returns {Promise<ReleasePackage>}
 */
async function describePackage(cwd, lastRelease, pkg) {
  const directory = path.relative(cwd, pkg.path).split(path.sep).join('/') || '.';
  const manifest = directory === '.' ? 'package.json' : `${directory}/package.json`;
  /** @type {boolean | null} */
  let changed = null;

  if (lastRelease) {
    // `./` resolves from `cwd`, not the repository root.
    const previous = await execa('git', ['show', `${lastRelease}:./${manifest}`], {
      cwd,
      reject: false,
    });

    changed = previous.exitCode !== 0 || JSON.parse(previous.stdout).version !== pkg.version;
  }

  return {
    name: pkg.name,
    version: pkg.version ?? null,
    private: pkg.isPrivate,
    path: directory,
    changed,
  };
}
