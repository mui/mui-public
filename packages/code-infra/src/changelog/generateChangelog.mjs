import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';
import { filterCommits } from './filterCommits.mjs';
import { categorizeCommits } from './categorizeCommits.mjs';
import { buildSections } from './buildSections.mjs';
import { formatChangelog, extractContributorsFromAllCommits } from './formatChangelog.mjs';
import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * @typedef {import('./types.ts').GenerateChangelogOptions} GenerateChangelogOptions
 * @typedef {import('./types.ts').GenerateChangelogResult} GenerateChangelogResult
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 */

/**
 * Generates a changelog for a release.
 *
 * @param {GenerateChangelogOptions} options - Options for generating the changelog
 * @returns {Promise<GenerateChangelogResult>} Changelog result with markdown and sections
 */
export async function generateChangelog(options) {
  // Fetch commits from GitHub
  const allCommits = await fetchCommitsBetweenRefs({
    repo: options.repo,
    org: options.org || 'mui',
    lastRelease: options.lastRelease,
    release: options.release,
  });
  const config = options.config;

  // Get workspace packages and their versions
  let packageVersions;
  try {
    const workspacePackages = await getWorkspacePackages({ publicOnly: true });
    packageVersions = new Map(workspacePackages.map((pkg) => [pkg.name, pkg.version]));
  } catch (error) {
    // If we can't get workspace packages (e.g., not in a pnpm workspace), continue without versions
    packageVersions = new Map();
  }

  // Extract contributors from ALL commits (excluding only excludeAuthors)
  // This ensures contributors are credited even if their commits are filtered out
  const contributors = extractContributorsFromAllCommits(allCommits, config.filter?.excludeAuthors);

  // Categorize ALL commits to track which packages had activity (only if showFilteredPackages is enabled)
  const allCategorizedCommits = config.filter?.showFilteredPackages
    ? categorizeCommits(allCommits, config.categorization)
    : undefined;

  // Filter commits for changelog content
  const commits = filterCommits(allCommits, config.filter);

  // Categorize filtered commits for actual changelog sections
  const categorizedCommits = categorizeCommits(commits, config.categorization);

  // Build sections with knowledge of which packages had filtered commits (if enabled)
  const sections = buildSections(
    categorizedCommits,
    config.categorization,
    config.planInheritance,
    allCategorizedCommits,
    packageVersions,
  );

  // Format changelog
  const markdown = formatChangelog(sections, config, options.version, options.date, contributors);

  return {
    markdown,
    sections,
    contributors,
  };
}
