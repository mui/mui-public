import { $ } from 'execa';

import { hasCommit } from './changelogFiles.mjs';

/**
 * The closest version tag behind a commit. Tags on the commit itself are the release being made, not
 * the one before it.
 *
 * @param {Object} options
 * @param {string} options.cwd
 * @param {string | null} options.remote - Remote to fetch the tags and the commit from
 * @param {string} options.sha
 * @returns {Promise<string>}
 */
export async function findPreviousVersionTag({ cwd, remote, sha }) {
  const $$ = $({ cwd });
  if (remote) {
    // --force to update any existing tags that may have changed to avoid the clobering error.
    const missing = (await hasCommit(cwd, sha)) ? [] : [sha];
    await $$`git fetch --tags --force ${remote} ${missing}`;
  }
  try {
    const { stdout: ownTags } = await $$`git tag --points-at ${sha}`;
    const excludes = ownTags.split('\n').flatMap((tag) => (tag ? ['--exclude', tag] : []));
    const { stdout } =
      await $$`git describe --tags --abbrev=0 --match ${'v[0-9]*'} ${excludes} ${sha}`;
    return stdout.trim();
  } catch (error) {
    throw new Error(
      `No version tag found behind ${sha}. A shallow clone is the usual cause: fetch the full ` +
        'history, or pass the `lastRelease` ref.',
      { cause: error },
    );
  }
}
