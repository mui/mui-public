/**
 * Changelog generation utilities.
 */

/**
 * @typedef {import('./types.ts').FetchChangelogDataOptions} FetchChangelogDataOptions
 * @typedef {import('./types.ts').ChangelogData} ChangelogData
 * @typedef {import('./types.ts').ChangelogChange} ChangelogChange
 * @typedef {import('./types.ts').ChangelogAuthor} ChangelogAuthor
 * @typedef {import('./types.ts').ChangelogPackage} ChangelogPackage
 * @typedef {import('./types.ts').ChangelogTitle} ChangelogTitle
 * @typedef {import('./types.ts').ChangelogCredits} ChangelogCredits
 * @typedef {import('./types.ts').MarkdownBlock} MarkdownBlock
 * @typedef {import('./types.ts').MarkdownInline} MarkdownInline
 */

export { generateChangelog } from './generateChangelog.mjs';
export * from './loadChangelogConfig.mjs';
export * from './fetchChangelogs.mjs';
export { fetchChangelogData } from './fetchChangelogData.mjs';
export {
  creditAuthors,
  groupBy,
  labelValues,
  readLabels,
  sortByTitle,
} from './changelogGrouping.mjs';
export {
  bulletList,
  formatAuthor,
  formatDate,
  formatReference,
  joinBlocks,
  joinWords,
  section,
} from './changelogMarkdown.mjs';
export { mapPrefixes, matchPrefix, parseTitle } from './changelogTitle.mjs';
// Moved to the git utilities, where the rest of the local git plumbing lives. Re-exported because
// `@mui/internal-code-infra/changelog` is a published entry point and this was part of it.
export { findLatestTaggedVersion } from '../utils/git.mjs';
