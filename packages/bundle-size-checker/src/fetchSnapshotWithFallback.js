import { fetchSnapshot } from './fetchSnapshot.js';
import { getParentCommits } from './git.js';

/**
 * Attempts to fetch a snapshot with fallback to parent commits
 * @param {string} repo - Repository name
 * @param {string} commit - The commit SHA to start from
 * @param {number} [fallbackDepth=3] - How many parent commits to try as fallback
 * @returns {Promise<{snapshot: import('./sizeDiff.js').SizeSnapshot | null, actualCommit: string | null}>}
 */
export async function fetchSnapshotWithFallback(repo, commit, fallbackDepth = 3) {
  // Try the original commit first
  try {
    const snapshot = await fetchSnapshot(repo, commit);
    return { snapshot, actualCommit: commit };
  } catch (/** @type {any} */ error) {
    // fallthrough to parent commits if the snapshot for the original commit fails
  }

  // Get parent commits and try each one
  const parentCommits = await getParentCommits(repo, commit, fallbackDepth);

  for (const parentCommit of parentCommits) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await fetchSnapshot(repo, parentCommit);
      return { snapshot, actualCommit: parentCommit };
    } catch {
      // fallthrough to the next parent commit if fetching fails
    }
  }

  return { snapshot: null, actualCommit: null };
}
