/**
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').FilterConfig} FilterConfig
 */

/**
 * Filters commits based on the configuration.
 *
 * @param {FetchedCommitDetails[]} commits - Commits to filter
 * @param {FilterConfig} [filterConfig] - Filter configuration
 * @returns {FetchedCommitDetails[]} Filtered commits
 */
export function filterCommits(commits, filterConfig) {
  if (!filterConfig) {
    return commits;
  }

  return commits.filter((commit) => {
    // Check author exclusions
    if (filterConfig.excludeCommitByAuthors && filterConfig.excludeCommitByAuthors.length > 0) {
      const authorLogin = commit.author?.login;
      if (authorLogin) {
        // Check if author matches any exclusion pattern
        for (const pattern of filterConfig.excludeCommitByAuthors) {
          if (pattern instanceof RegExp) {
            if (pattern.test(authorLogin)) {
              return false;
            }
          } else if (authorLogin.includes(pattern)) {
            return false;
          }
        }
      }
    }

    // Check label exclusions
    if (filterConfig.excludeCommitWithLabels && filterConfig.excludeCommitWithLabels.length > 0) {
      // Check if commit has any excluded labels
      for (const excludedLabel of filterConfig.excludeCommitWithLabels) {
        if (excludedLabel instanceof RegExp) {
          if (commit.labels.some((label) => excludedLabel.test(label))) {
            return false;
          }
        } else if (commit.labels.includes(excludedLabel)) {
          return false;
        }
      }
    }

    // Apply custom filter if provided
    if (filterConfig.customFilter) {
      return filterConfig.customFilter(commit);
    }

    return true;
  });
}
