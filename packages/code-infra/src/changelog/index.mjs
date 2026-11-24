/**
 * Changelog generation utilities.
 */

/**
 * @typedef {import('./types.ts').FetchChangelogDataOptions} FetchChangelogDataOptions
 * @typedef {import('./types.ts').ChangelogData} ChangelogData
 * @typedef {import('./types.ts').ChangelogChange} ChangelogChange
 * @typedef {import('./types.ts').ChangelogAuthor} ChangelogAuthor
 * @typedef {import('./types.ts').ChangelogPackage} ChangelogPackage
 */

export { generateChangelog } from './generateChangelog.mjs';
export * from './loadChangelogConfig.mjs';
export * from './fetchChangelogs.mjs';
export { fetchChangelogData } from './fetchChangelogData.mjs';
// Moved to the git utilities, where the rest of the local git plumbing lives. Re-exported because
// `@mui/internal-code-infra/changelog` is a published entry point and this was part of it.
export { findLatestTaggedVersion } from '../utils/git.mjs';
