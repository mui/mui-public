import { fetchCommitsBetweenRefs } from './fetchChangelogs.mjs';
import { filterCommits } from './filterCommits.mjs';
import { categorizeCommits } from './categorizeCommits.mjs';
import { buildSections } from './buildSections.mjs';
import { formatChangelog, extractContributorsFromAllCommits } from './formatChangelog.mjs';

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

  // Extract contributors from ALL commits (excluding only excludeAuthors)
  // This ensures contributors are credited even if their commits are filtered out
  const contributors = extractContributorsFromAllCommits(allCommits, config.filter?.excludeAuthors);

  // Filter commits for changelog content
  const commits = filterCommits(allCommits, config.filter);

  // Categorize commits
  const categorizedCommits = categorizeCommits(commits, config.categorization);

  // Build sections
  const sections = buildSections(categorizedCommits, config.categorization, config.planInheritance);

  // Format changelog
  const markdown = formatChangelog(sections, config, options.version, options.date, contributors);

  return {
    markdown,
    sections,
    contributors,
  };
}
