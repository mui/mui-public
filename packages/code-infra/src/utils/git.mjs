import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';

/**
 * @typedef {Object} RepoInfo
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 */

/**
 * Get current repository info from git remote
 * @param {string[]} [remotes=['upstream', 'origin']] - Remote name(s) to check (default: ['upstream', 'origin'])
 * @returns {Promise<RepoInfo>} Repository owner and name
 */
export async function getRepositoryInfo(remotes = ['upstream', 'origin']) {
  /**
   * @type {Record<string, string>}
   */
  const cause = {};
  const cliResult = $`git remote -v`;
  /**
   * @type {Map<string, string>}
   */
  const repoRemotes = new Map();

  for await (const line of cliResult) {
    // Match pattern: "remoteName url (fetch|push)"
    const [remoteName, url, type] = line.trim().split(/\s+/, 3);
    if (type === '(fetch)') {
      repoRemotes.set(remoteName, url);
    } else if (type !== '(push)') {
      throw new Error(`Unexpected line format for "git remote -v": "${line}"`);
    }
  }

  for (const remote of remotes) {
    if (!repoRemotes.has(remote)) {
      cause[remote] = 'Remote not found';
      continue;
    }
    const url = /** @type {string} */ (repoRemotes.get(remote));
    try {
      const parsed = gitUrlParse(url);
      if (parsed.source !== 'github.com' || parsed.owner !== 'mui') {
        cause[remote] = `Remote is not a GitHub repository under 'mui' organization: ${url}`;
        continue;
      }
      return {
        owner: parsed.owner,
        repo: parsed.name,
      };
    } catch (error) {
      cause[remote] = `Failed to parse URL for remote ${remote}: ${url}`;
    }
  }

  throw new Error(`Failed to find remote(s): ${remotes.join(', ')}`, { cause });
}

/**
 * Get current git SHA
 * @returns {Promise<string>} Current git commit SHA
 */
export async function getCurrentGitSha() {
  const result = await $`git rev-parse HEAD`;
  return result.stdout.trim();
}
