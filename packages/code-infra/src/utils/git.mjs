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
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<RepoInfo>} Repository owner and name
 */
export async function getRepositoryInfo(cwd = process.cwd()) {
  /**
   * @type {Record<string, string>}
   */
  const cause = {};
  const { stdout } = await $({ cwd })`git remote -v`;
  const lines = stdout.trim().split('\n');
  /**
   * @type {Set<string>}
   */
  const repoRemotes = new Set();
  /**
   * @type {Map<string, { owner: string, repo: string }>}
   */
  const validRemotes = new Map();

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
        if (!validRemotes.has(remoteName)) {
          validRemotes.set(remoteName, { owner: parsed.owner, repo: parsed.name });
        }
      } catch (error) {
        cause[remoteName] = `Failed to parse URL for remote ${remoteName}: ${url}`;
      }
    } else if (type !== '(push)') {
      throw new Error(`Unexpected line format for "git remote -v": "${line}"`);
    }
  }

  const preferredOrder = ['upstream', 'origin', ...validRemotes.keys()];
  for (const name of preferredOrder) {
    const match = validRemotes.get(name);
    if (match) {
      return { ...match, remoteName: name };
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
