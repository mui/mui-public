/**
 * Changelog generation utilities.
 */

/**
 * @typedef {import('./types.ts').FetchReleaseFactsOptions} FetchReleaseFactsOptions
 * @typedef {import('./types.ts').ReleaseFacts} ReleaseFacts
 * @typedef {import('./types.ts').ReleaseChange} ReleaseChange
 * @typedef {import('./types.ts').ReleaseAuthor} ReleaseAuthor
 * @typedef {import('./types.ts').ReleasePackage} ReleasePackage
 */

export { generateChangelog } from './generateChangelog.mjs';
export * from './loadChangelogConfig.mjs';
export * from './fetchChangelogs.mjs';
export { fetchReleaseFacts } from './fetchReleaseFacts.mjs';
// Moved to the git utilities, where the rest of the local git plumbing lives. Re-exported because
// `@mui/internal-code-infra/changelog` is a published entry point and this was part of it.
export { findLatestTaggedVersion } from '../utils/git.mjs';
