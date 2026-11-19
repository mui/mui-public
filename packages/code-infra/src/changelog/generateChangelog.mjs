import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePackages } from '../utils/pnpm.mjs';
import { findLatestTaggedVersion, getRepositoryInfo, getCurrentGitSha } from '../utils/git.mjs';
import { loadChangelogConfig } from './loadChangelogConfig.mjs';
import { buildSections } from './buildSections.mjs';
import { categorizeCommits } from './categorizeCommits.mjs';
import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';
import { filterCommits } from './filterCommits.mjs';
import { extractContributorsFromAllCommits, renderChangelog } from './renderChangelog.mjs';
import { sortSections } from './sortSections.mjs';

const DEFAULT_CONFIG = 'scripts/changelog.config.mjs';
const HTTP_NOT_FOUND = 404;

/**
 * @typedef {import('./types.ts').GenerateChangelogOptions} GenerateChangelogOptions
 * @typedef {import('./types.ts').GenerateChangelogResult} GenerateChangelogResult
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 */

/**
 * Generates a changelog for a release.
 *
 * @param {GenerateChangelogOptions} [options] - Options for generating the changelog
 * @returns {Promise<GenerateChangelogResult>} Changelog result with markdown and sections
 */
export async function generateChangelog(options = {}) {
  const cwd = await fs.realpath(options.cwd ?? process.cwd());
  const config =
    typeof options.config === 'object'
      ? options.config
      : await loadChangelogConfig(options.config ?? DEFAULT_CONFIG, cwd);
  const repository = options.repo
    ? { repo: options.repo, owner: options.org ?? 'mui' }
    : await getRepositoryInfo(cwd);
  const releaseRef = options.release || 'HEAD';
  const localHead = releaseRef === 'HEAD';
  const release = {
    lastRelease: options.lastRelease ?? (await findLatestTaggedVersion({ cwd })),
    release: localHead ? await getCurrentGitSha(cwd) : releaseRef,
    version:
      options.version ??
      JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).version,
    date: options.date ?? new Date(),
  };

  let allCommits;
  try {
    allCommits = await fetchCommitsBetweenRefs({
      repo: repository.repo,
      org: options.org ?? repository.owner,
      lastRelease: release.lastRelease,
      release: release.release,
      octokit: options.octokit,
    });
  } catch (error) {
    if (
      localHead &&
      error instanceof Error &&
      'status' in error &&
      error.status === HTTP_NOT_FOUND
    ) {
      throw new Error(
        `GitHub could not compare ${release.lastRelease} with local HEAD ${release.release}. Push HEAD or pass --release, and verify the base ref and repository access.`,
        { cause: error },
      );
    }
    throw error;
  }
  const commits = filterCommits(allCommits, config.filter);

  // Get workspace packages and their versions
  /**
   * @type {Map<string, string>}
   */
  let packageVersions;
  try {
    const workspacePackages = await getWorkspacePackages({ publicOnly: true, cwd });
    packageVersions = new Map(workspacePackages.map((pkg) => [pkg.name, pkg.version]));
  } catch (error) {
    // If we can't get workspace packages (e.g., not in a pnpm workspace), continue without versions
    packageVersions = new Map();
  }

  // Extract contributors from ALL commits (excluding only excludeAuthors)
  // This ensures contributors are credited even if their commits are filtered out
  const contributors = extractContributorsFromAllCommits(
    commits,
    config.filter?.excludeCommitByAuthors,
  );

  const categories = categorizeCommits(commits, config.categorization);
  const unsortedSections = buildSections(categories, config.categorization, packageVersions);
  const sections = sortSections(unsortedSections, config.categorization);
  const markdown = renderChangelog(sections, config, release, contributors);

  return {
    markdown,
    sections,
    contributors,
  };
}
