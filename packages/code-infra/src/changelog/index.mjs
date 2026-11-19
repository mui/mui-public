/**
 * Changelog generation utilities.
 */

export { generateChangelog } from './generateChangelog.mjs';

export { fetchReleaseFacts } from './fetchReleaseFacts.mjs';

export { configView } from './configView.mjs';

export * from './prepare.mjs';

export * from './md.mjs';

export * from './loadChangelogConfig.mjs';

export * from './fetchChangelogs.mjs';

// Moved to the git utilities, where the rest of the local git plumbing lives. Re-exported because
// `@mui/internal-code-infra/changelog` is a published entry point and this was part of it.
export { findLatestTaggedVersion } from '../utils/git.mjs';

/** @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig */
/** @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails */
/** @typedef {import('./types.ts').DirectCommitDetails} DirectCommitDetails */
/** @typedef {import('./types.ts').GenerateChangelogOptions} GenerateChangelogOptions */
/** @typedef {import('./types.ts').GenerateChangelogResult} GenerateChangelogResult */
/** @typedef {import('./types.ts').ReleaseFacts} ReleaseFacts */
/** @typedef {import('./types.ts').ReleaseEntry} ReleaseEntry */
/** @typedef {import('./types.ts').ReleasePackage} ReleasePackage */
/** @typedef {import('./types.ts').FetchReleaseFactsOptions} FetchReleaseFactsOptions */
/**
 * @template Prepared
 * @typedef {import('./types.ts').ChangelogPreset<Prepared>} ChangelogPreset
 */
