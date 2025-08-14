import { execa } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * Gets parent commits for a given commit SHA using git CLI
 * @param {string} repo - Repository name (e.g., 'mui/material-ui') - ignored for git CLI
 * @param {string} commit - The commit SHA to start from
 * @param {number} depth - How many commits to retrieve (including the starting commit)
 * @returns {Promise<string[]>} Array of commit SHAs in chronological order (excluding the starting commit)
 */
export async function getParentCommits(repo, commit, depth = 3) {
  const { stdout } = await execa('git', ['rev-list', `--max-count=${depth}`, '--skip=1', commit]);
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Compares two commits and returns merge base information using git CLI
 * @param {string} base - Base commit SHA
 * @param {string} head - Head commit SHA
 * @returns {Promise<string>} Object with merge base commit info
 */
export async function getMergeBase(base, head) {
  const { stdout } = await execa('git', ['merge-base', base, head]);
  return stdout.trim();
}

/**
 * Gets the current repository owner and name from git remote
 * @returns {Promise<{owner: string | null, repo: string | null}>}
 */
export async function getCurrentRepoInfo() {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    const parsed = gitUrlParse(stdout.trim());
    return {
      owner: parsed.owner,
      repo: parsed.name,
    };
  } catch (error) {
    return {
      owner: null,
      repo: null,
    };
  }
}
