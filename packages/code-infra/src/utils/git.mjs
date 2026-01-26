import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * @typedef {Object} RepoInfo
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {string} remoteName - Remote name
 */

/**
 * Get current repository info from git remote
 * @returns {Promise<RepoInfo>} Repository owner and name
 */
export async function getRepositoryInfo() {
  /**
   * @type {Record<string, string>}
   */
  const cause = {};
  const { stdout } = await $`git remote -v`;
  const lines = stdout.trim().split('\n');
  /**
   * @type {Set<string>}
   */
  const repoRemotes = new Set();

  for (const line of lines) {
    // Match pattern: "remoteName url (fetch|push)"
    const [remoteName, url, type] = line.trim().split(/\s+/, 3);
    repoRemotes.add(remoteName);
    if (type === '(fetch)') {
      try {
        const parsed = gitUrlParse(url);
        if (parsed.source !== 'github.com' || parsed.owner !== 'mui') {
          cause[remoteName] = `Remote is not a GitHub repository under 'mui' organization: ${url}`;
          continue;
        }
        return {
          owner: parsed.owner,
          repo: parsed.name,
          remoteName,
        };
      } catch (error) {
        cause[remoteName] = `Failed to parse URL for remote ${remoteName}: ${url}`;
      }
    }
    if (type !== '(push)') {
      throw new Error(`Unexpected line format for "git remote -v": "${line}"`);
    }
  }

  throw new Error(
    `Failed to find correct remote(s) in : ${Array.from(repoRemotes.keys()).join(', ')}`,
    { cause },
  );
}

/**
 * Get current git SHA
 * @returns {Promise<string>} Current git commit SHA
 */
export async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
}
