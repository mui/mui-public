import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import Ajv from 'ajv';
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * @typedef {Object} NewCommitDetails
 * @property {string} sha
 * @property {string} message
 * @property {string[]} labels
 * @property {number} prNumber
 * @property {string | null} author
 */

/**
 * @typedef {Object} CategorizedCommit
 * @property {string} sha
 * @property {string} message
 * @property {string[]} labels
 * @property {number} prNumber
 * @property {string | null} author
 * @property {{title: string; priority?: number} | null} category
 * @property {{title: string; priority?: number}[]} sections
 * @property {string[]} flags
 * @property {boolean} addToChangelog
 * @property {boolean} [isFromCatchAllCategory]
 */

/**
 * @typedef {Object} LabelMatch
 * @property {string} key
 * @property {import('./changelog-config').LabelInfo} config
 * @property {Record<string, string>} groups
 */

/**
 * @typedef {import('../github-gql').CommitConnection} CommitConnection
 */

/**
 * @typedef {Object} Args
 * @property {string} repo
 * @property {string} githubToken
 * @property {string} [lastRelease]
 * @property {string} [repoPath=process.cwd()]
 * @property {string} [release=master]
 * @property {'graphql' | 'rest'} [api=rest]
 * @property {'changelog' | 'docs'} [format=changelog]
 */

/**
 * @param {Args} args
 * @returns {Promise<string>}
 */
export default async function getCategorisedChangelog(args) {
  const cwd = args.repoPath ?? process.cwd();
  if (!args.githubToken) {
    throw new Error(
      'GitHub token is required. Please provide it via --githubToken flag or set in GITHUB_TOKEN environment variable.',
    );
  }
  const config = /** @type {import('./changelog-config').ChangelogConfig} */ (
    JSON.parse(await fs.readFile(path.join(cwd, '.github', 'changelog.config.json'), 'utf-8'))
  );

  // Validate config against JSON schema
  const ajv = new Ajv({ allErrors: true, strict: true });
  const schemaPath = new URL(import.meta.resolve('../../changelog-schema.json')).pathname;
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf-8'));

  const validate = ajv.compile(schema);
  if (!validate(config)) {
    throw new Error(
      `Invalid changelog config:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`,
    );
  }

  const commits = await getCategorizedCommitsWithConfig(args, config, { cwd });
  const pkgJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
  return generateChangelogFromCategorizedCommits(commits, config, {
    repo: args.repo,
    version: pkgJson.version,
    format: args.format,
  });
}

/**
 * Generates a changelog from categorized commits. This includes sorting by category and
 * section priorities, formatting commit messages with flags, sorting relative to the
 * flags (if present), and compiling a list of contributors.
 *
 * @param {CategorizedCommit[]} commits
 * @param {import('./changelog-config').ChangelogConfig} config
 * @param {Object} options
 * @param {string} options.repo
 * @param {string} options.version
 * @param {Args['format']} [options.format='changelog']
 * @returns {string}
 */
export function generateChangelogFromCategorizedCommits(commits, config, options) {
  const { format = 'changelog', repo, version } = options;
  const relevantCommits = commits.filter((commit) => commit.addToChangelog);

  const uncategorizedCommits = relevantCommits.filter((commit) => commit.category === null);
  if (uncategorizedCommits.length > 0) {
    console.warn(
      `⚠️  There are ${uncategorizedCommits.length} uncategorized commits. Please check your changelog configuration:\n${uncategorizedCommits
        .map(
          (commit) =>
            `- ${commit.message} (#${commit.prNumber}) (label: ${commit.labels.join(', ')})`,
        )
        .join('\n')}`,
    );
  }
  /**
   * @type {Map<string, number>}
   */
  const categoryPriorityMap = new Map();
  /**
   * @type {Map<string, number>}
   */
  const sectionPriorityMap = new Map();
  /**
   * @type {Map<string, CategorizedCommit[]>}
   */
  const categoryCommitsMap = new Map();
  /**
   * @type {Map<string, CategorizedCommit[]>}
   */
  const sectionCommitsMap = new Map();

  relevantCommits.forEach((commit) => {
    const { category, sections } = commit;
    if (category === null) {
      return;
    }
    if (typeof category?.priority === 'number' && !categoryPriorityMap.has(category.title)) {
      categoryPriorityMap.set(category.title, category.priority);
    }

    sections.forEach((section) => {
      if (typeof section.priority === 'number' && !sectionPriorityMap.has(section.title)) {
        sectionPriorityMap.set(section.title, section.priority);
      }
    });

    if (commit.isFromCatchAllCategory) {
      sections.forEach((section) => {
        const existingCommits = sectionCommitsMap.get(section.title) || [];
        existingCommits.push(commit);
        sectionCommitsMap.set(section.title, existingCommits);
      });
    } else {
      const existingCommits = categoryCommitsMap.get(category.title) || [];
      existingCommits.push(commit);
      categoryCommitsMap.set(category.title, existingCommits);
    }
  });

  const sortedSectionEntries = Array.from(sectionCommitsMap.keys()).sort((a, b) => {
    const priorityA = sectionPriorityMap.get(a);
    const priorityB = sectionPriorityMap.get(b);
    if (typeof priorityA === 'number' && typeof priorityB === 'number') {
      return priorityA - priorityB;
    }
    if (typeof priorityA === 'number') {
      return -1;
    }
    if (typeof priorityB === 'number') {
      return 1;
    }
    return a.localeCompare(b);
  });

  const sortedCategoryEntries = Array.from(categoryCommitsMap.keys()).sort((a, b) => {
    const priorityA = categoryPriorityMap.get(a);
    const priorityB = categoryPriorityMap.get(b);
    if (typeof priorityA === 'number' && typeof priorityB === 'number') {
      return priorityA - priorityB;
    }
    if (typeof priorityA === 'number') {
      return -1;
    }
    if (typeof priorityB === 'number') {
      return 1;
    }
    return a.localeCompare(b);
  });

  let changelog = '';

  /**
   * @param {string[]} entries
   * @param {Map<string, CategorizedCommit[]>} commitMap
   */
  function updateChangelog(entries, commitMap) {
    entries.forEach((section) => {
      let commitList = commitMap.get(section) ?? [];
      // Remove duplicates by prNumber, keeping the first occurrence
      const seenPrNumbers = new Set();
      commitList = commitList.filter((commit) => {
        if (seenPrNumbers.has(commit.prNumber)) {
          return false;
        }
        seenPrNumbers.add(commit.prNumber);
        return true;
      });
      if (!commitList.length) {
        return;
      }
      changelog += `\n### ${section}\n\n`;

      Object.keys(config.flags ?? {}).forEach((flag) => {
        commitList = commitList.slice().sort((a, b) => {
          const priority = config.flags?.[flag].priority;
          if (typeof priority !== 'number') {
            return 0;
          }
          const aHasFlag = a.flags.includes(flag);
          const bHasFlag = b.flags.includes(flag);
          if (!aHasFlag && aHasFlag === bHasFlag) {
            return 0;
          }
          if (aHasFlag && bHasFlag) {
            return 0;
          }
          if (aHasFlag && !bHasFlag) {
            return -1;
          }
          if (!aHasFlag && bHasFlag) {
            return 1;
          }
          return priority;
        });
      });
      commitList.forEach((commit) => {
        let commitMessage = commit.message;
        let hasSuffix = false;
        // Highlight flags in the commit message
        Object.keys(config.flags || {}).forEach((flag) => {
          if (!commit.flags.includes(flag)) {
            return;
          }
          const flagConfig = config.flags?.[flag];
          if (flagConfig?.prefix) {
            commitMessage = `${flagConfig.prefix}${commitMessage}`;
          }
          if (flagConfig?.suffix) {
            commitMessage = `${commitMessage}${flagConfig.suffix}`;
            hasSuffix = true;
          }
        });

        const formattedPrNumber =
          format === 'changelog'
            ? `(#${commit.prNumber})`
            : `([#${commit.prNumber}](https://github.com/mui/${repo}/pull/${commit.prNumber}))`;

        changelog += `- ${commitMessage}${hasSuffix ? '' : ' '}${formattedPrNumber} by @${commit.author}\n`;
      });
    });
  }
  updateChangelog(sortedSectionEntries, sectionCommitsMap);
  updateChangelog(sortedCategoryEntries, categoryCommitsMap);

  const date = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contributors = Array.from(
    new Set(
      commits
        .map((commit) => commit.author)
        .filter((author) => author !== null)
        .map((author) => `@${author}`),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const contributorsText =
    format === 'changelog' && contributors.length > 0
      ? `

All contributors of this release in alphabetical order: ${
          // eslint-disable-next-line no-nested-ternary
          contributors.length === 1
            ? contributors[0]
            : contributors.length === 2
              ? `${contributors[0]} and ${contributors[1]}`
              : `${contributors.slice(0, -1).join(', ')} and ${contributors[contributors.length - 1]}`
        }
`
      : '';

  return `## v${version || 'NEXT_RELEASE'}

${format === 'changelog' ? `_${date}_` : `**${date}**`}

${changelog.trim()}${contributorsText}`;
}

/**
 * Fetches commits from GitHub (either using graphql or rest) between two refs and
 * categorizes them using the provided config.
 *
 * @param {Args} args
 * @param {import('./changelog-config').ChangelogConfig} config
 * @param {Object} param2
 * @param {string} param2.cwd
 * @returns {Promise<CategorizedCommit[]>}
 */
export async function getCategorizedCommitsWithConfig(args, config, { cwd }) {
  const { githubToken, lastRelease, release = 'master', repo, api = 'graphql' } = args;
  const latestTaggedVersion = await findLatestTaggedVersion(cwd);
  const previousRelease = lastRelease ?? latestTaggedVersion;
  if (previousRelease !== latestTaggedVersion) {
    console.warn(
      `⚠️ Creating changelog for ${previousRelease}..${release} while the latest tagged version is '${latestTaggedVersion}'.`,
    );
  }
  const commits =
    api === 'graphql'
      ? await findCommitsGraphql({
          token: githubToken,
          repo,
          lastRelease: previousRelease,
          release,
        })
      : await findCommitsRest({
          token: githubToken,
          repo,
          lastRelease: previousRelease,
          release,
        });

  return categorizeCommits(commits, config);
}

/**
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function findLatestTaggedVersion(cwd) {
  const { stdout } = await $({ cwd })`git describe --tags --abbrev=0 --match ${'v*'}`; // only include "version-tags"
  return stdout.trim();
}

/**
 * Fetches commits between two refs using GitHub's GraphQL API over a single network call.
 * Its efficient but is not as reliable as the REST API. So keeping both implementations
 * for the time being.
 *
 * @param {Object} param0
 * @param {string} param0.token
 * @param {string} param0.repo
 * @param {string} param0.lastRelease
 * @param {string} param0.release
 *
 * @returns {Promise<NewCommitDetails[]>}
 */
async function findCommitsGraphql({ token, repo, lastRelease, release }) {
  const gql = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });
  /**
   * @param {string | null} commitAfter
   * @returns {Promise<{repository: {ref: {compare: {commits: CommitConnection}}}}>}
   */
  async function fetchCommits(commitAfter = null) {
    return await gql({
      query: `query GetCommitsBetweenRefs($org: String!, $repo: String!, $baseRef: String!, $headRef: String!, $commitCount: Int!, $commitAfter: String) {
  repository(owner: $org, name: $repo) {
    ref(qualifiedName: $baseRef) {
      compare(headRef: $headRef) {
        commits(first: $commitCount, after: $commitAfter) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            oid
            authoredDate
            message
            author {
              user {
                login
              }
            }
            associatedPullRequests(first: 1) {
              nodes {
                number
                author {
                  login
                }
                labels(first: 20) {
                  nodes {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
      org: 'mui',
      repo,
      commitAfter,
      baseRef: lastRelease,
      headRef: release,
      commitCount: 100,
    });
  }

  let hasNextPage = true;
  /**
   * @type {string | null}
   */
  let commitAfter = null;
  /**
   * @type {import('../github-gql').CommitNode[]}
   */
  let allCommits = [];
  // fetch all commits (with pagination)
  do {
    /**
     * @type {CommitConnection}
     */
    // eslint-disable-next-line no-await-in-loop
    const commits = (await fetchCommits(commitAfter)).repository.ref.compare.commits;
    hasNextPage = !!commits.pageInfo.hasNextPage;
    commitAfter = hasNextPage ? commits.pageInfo.endCursor : null;
    allCommits.push(...commits.nodes);
  } while (hasNextPage);

  allCommits = allCommits.filter((commit) => commit.associatedPullRequests.nodes.length > 0);

  return allCommits.map((commit) => {
    const labels = commit.associatedPullRequests.nodes.flatMap((pr) =>
      pr.labels.nodes.map((label) => label.name),
    );

    return {
      sha: commit.oid,
      message: cleanCommitMessage(commit.message),
      labels,
      prNumber: commit.associatedPullRequests.nodes[0].number,
      author: commit.associatedPullRequests.nodes[0].author.user?.login ?? null,
    };
  });
}

/**
 * @typedef {Awaited<ReturnType<Octokit['repos']['compareCommits']>>['data']['commits']} CompareCommitsResult
 */

/**
 * Fetches commits between two refs using GitHub's REST API.
 * It is more reliable than the GraphQL API but requires multiple network calls (n + 1).
 *
 * @param {Object} param0
 * @param {string} param0.token
 * @param {string} param0.repo
 * @param {string} param0.lastRelease
 * @param {string} param0.release
 *
 * @returns {Promise<NewCommitDetails[]>}
 */
async function findCommitsRest({ token, repo, lastRelease, release }) {
  const octokit = new Octokit({
    auth: token,
  });
  /**
   * @type {CompareCommitsResult}
   */
  const results = [];
  /**
   * @type {any}
   */
  const timeline = octokit.paginate.iterator(
    octokit.repos.compareCommitsWithBasehead.endpoint.merge({
      owner: 'mui',
      repo,
      basehead: `${lastRelease}...${release}`,
    }),
  );
  for await (const response of timeline) {
    results.push(...response.data.commits);
  }

  const promises = results.map(async (commit) => {
    const prMatch = commit.commit.message.match(/#(\d+)/);
    if (prMatch === null) {
      return null;
    }

    const prNumber = parseInt(prMatch[1], 10);

    const pr = await octokit.pulls.get({
      owner: 'mui',
      repo,
      pull_number: prNumber,
      headers: {
        Accept: 'application/vnd.github.text+json',
      },
    });

    const labels = pr.data.labels.map((label) => label.name);

    return /** @type {NewCommitDetails} */ ({
      sha: commit.sha,
      message: cleanCommitMessage(commit.commit.message),
      labels,
      prNumber,
      author: pr.data.user?.login ?? null,
    });
  });

  return (await Promise.all(promises)).filter((entry) => entry !== null);
}

/**
 * @param {string} commitMessage
 * @returns {string}
 */
function cleanCommitMessage(commitMessage) {
  return commitMessage
    .split('\n')[0]
    .replace(/^(\[[A-Za-z0-9\s,-]+\])+ /, '') // remove the leading tags
    .replace(/\(#\d+\)/, '') // remove the PR number
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .trim();
}

/**
 *
 * @param {NewCommitDetails[]} commits
 * @param {import('./changelog-config').ChangelogConfig} config
 */
export function categorizeCommits(commits, config) {
  /**
   * @type {NewCommitDetails[]}
   */
  const skippedCommits = [];
  /**
   * @type {CategorizedCommit[]}
   */
  const results = [];
  for (const commit of commits) {
    if (
      config.ignoreAuthors?.length &&
      config.ignoreAuthors.some((pattern) => new RegExp(pattern).test(commit.author || ''))
    ) {
      skippedCommits.push(commit);
      continue;
    }
    const originalLabels = [...commit.labels];
    /**
     * @type {CategorizedCommit}
     */
    const changelogConfig = {
      sha: commit.sha,
      message: cleanCommitMessage(commit.message),
      labels: originalLabels,
      prNumber: commit.prNumber,
      author: commit.author,
      category: null,
      sections: [],
      flags: [],
      addToChangelog: false,
      isFromCatchAllCategory: false,
    };

    let isCatchAllAlreadyMatched = false;
    for (const category in config.categories) {
      if (!Object.prototype.hasOwnProperty.call(config.categories, category)) {
        continue;
      }
      const categoryConfig = config.categories[category];

      if (categoryConfig.isCatchAll) {
        if (isCatchAllAlreadyMatched) {
          throw new Error(
            `You can only specify one catch call category in your config. Found multiple.`,
          );
        }
        isCatchAllAlreadyMatched = true;
      }

      const matchResult = matchLabelsWithGroups(commit.labels, categoryConfig.labels);
      if (matchResult) {
        changelogConfig.category = {
          title: interpolateTitle(
            categoryConfig.title || category,
            matchResult.groups,
            categoryConfig.map,
          ),
        };
        if (categoryConfig.priority !== undefined) {
          changelogConfig.category.priority = categoryConfig.priority;
        }
        changelogConfig.addToChangelog = categoryConfig.addToChangelog ?? true;
        changelogConfig.isFromCatchAllCategory = !!categoryConfig.isCatchAll;
        if (!categoryConfig.isCatchAll) {
          commit.labels = commit.labels.filter((label) => label !== matchResult.matchedLabel);
        }
        break;
      }
    }

    for (const flag in config.flags) {
      if (!Object.prototype.hasOwnProperty.call(config.flags, flag)) {
        continue;
      }
      const flagConfig = config.flags[flag];
      const matchResult = matchLabelsWithGroups(commit.labels, flagConfig.labels);
      if (matchResult) {
        changelogConfig.flags.push(flag);
      }
    }

    /**
     * @type {CategorizedCommit["sections"]}
     */
    const sections = [];
    for (const label in config.sections) {
      if (!Object.prototype.hasOwnProperty.call(config.sections, label)) {
        continue;
      }
      const labelConfig = config.sections[label];
      const commitLabels = [...commit.labels];
      for (const commitLabel of commitLabels) {
        const matchResult = matchLabelsWithGroups([commitLabel], labelConfig.labels);
        if (matchResult) {
          commit.labels = commit.labels.filter((l) => l !== matchResult.matchedLabel);
          const title = interpolateTitle(
            labelConfig.title || label,
            matchResult.groups,
            labelConfig.map,
          );
          const labelMap = labelConfig.map?.[matchResult.groups.label];
          /**
           * @type {number | undefined}
           */
          let priority;
          if (
            typeof labelMap === 'object' &&
            labelMap !== null &&
            labelMap.priority !== undefined
          ) {
            priority = labelMap.priority;
          }
          sections.push(
            typeof priority === 'number'
              ? {
                  title,
                  priority,
                }
              : { title },
          );
        }
      }
    }

    changelogConfig.sections = Array.from(sections);

    results.push(changelogConfig);
  }

  return results;
}

/**
 * @param {string[]} labels
 * @param {string[]} regexMatchers
 * @returns {null | {matchedLabel: string, groups: Record<string, string>}}
 */
function matchLabelsWithGroups(labels, regexMatchers) {
  for (const matcher of regexMatchers) {
    const regex = new RegExp(matcher);
    for (const label of labels) {
      const match = regex.exec(label);
      if (match) {
        const groups = match.groups || {};
        return {
          matchedLabel: label,
          groups: { ...groups },
        };
      }
    }
  }
  return null;
}

/**
 * Interpolates title template with captured groups and applies mapping. Also applies startCase formatting.
 * So a string like "{label} world {label}" with group { label: "Hello" } becomes "Hello world Hello".
 *
 * @param {string} titleTemplate - Title template with {groupName} placeholders
 * @param {Record<string, string>} groups - Captured groups from regex
 * @param {import('./changelog-config').LabelInfo["map"]} [map] - Optional mapping for group values
 * @param {Object} [options]
 * @param {boolean} [options.startCase=true] - If true, adds startCase formatting
 * @returns {string} - Interpolated title
 */
function interpolateTitle(titleTemplate, groups, map, options = {}) {
  const { startCase: applyStartCase = true } = options;
  let title = titleTemplate;

  for (const [groupName, groupValue] of Object.entries(groups)) {
    const mappedValue = map && map[groupValue] ? map[groupValue] : groupValue;
    title = title.replace(
      new RegExp(`\\{\\s?${groupName}\\s?\\}`, 'g'),
      typeof mappedValue === 'string' ? mappedValue : mappedValue.label,
    );
  }

  return applyStartCase ? startCase(title) : title;
}

/**
 * Converts string to start case unless it is camelCase.
 * "fooBar" -> "fooBar", "foo-bar_baz" -> "Foo Bar Baz"
 *
 * @param {string} str
 * @returns {string}
 */
function startCase(str) {
  // Check if string starts with lowercase and contains camelCase
  if (str[0] === '@' || (/^[a-zA-Z]/.test(str) && /[a-z][A-Z]/.test(str))) {
    return str; // Return unchanged if camelCase detected
  }
  return loStartCase(str);
}

/**
 * Implements lodash's startCase function.
 * Converts string to start case: "fooBar" -> "Foo Bar", "foo-bar_baz" -> "Foo Bar Baz"
 * Handles various string formats including camelCase, kebab-case, snake_case, and mixed formats.
 * @param {string} str
 * @returns {string}
 */
function loStartCase(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return (
    str
      // Replace underscores and hyphens with spaces
      .replace(/[_-]+/g, ' ')
      // Handle special characters and punctuation (replace with spaces)
      .replace(/[^\w\s]/g, ' ')
      // Handle transitions from lowercase/digit to uppercase
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      // Handle transitions from uppercase to lowercase (for acronyms like XMLHttpRequest)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // Handle transitions between letters and numbers
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      // Replace multiple whitespace characters with single space
      .replace(/\s+/g, ' ')
      // Trim leading and trailing whitespace
      .trim()
      // Split into words and capitalize each word
      .split(' ')
      .map((word) => {
        if (!word) {
          return '';
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ')
  );
}
