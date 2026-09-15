/**
 * Changelog generation utilities.
 */

export { generateChangelog } from './generateChangelog.mjs';
export * from './loadChangelogConfig.mjs';
export * from './fetchChangelogs.mjs';
// Moved to the git utilities, where the rest of the local git plumbing lives. Re-exported because
// `@mui/internal-code-infra/changelog` is a published entry point and this was part of it.
export { findLatestTaggedVersion } from '../utils/git.mjs';
