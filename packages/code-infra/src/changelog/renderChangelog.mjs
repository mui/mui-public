import { startCase } from 'es-toolkit/string';
import { templateString } from '../utils/template.mjs';

/**
 * @typedef {import('./types.js').ChangelogSection} ChangelogSection
 * @typedef {import('./types.js').CategorizedCommit} CategorizedCommit
 * @typedef {import('./types.js').ChangelogConfig} ChangelogConfig
 * @typedef {import('./types.js').GenerateChangelogResult} GenerateChangelogResult
 */

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Extracts tags from the start of a commit message.
 * Tags are in the format [tag1][tag2]... at the beginning of the message.
 * Returns the tags in order and the remaining message.
 *
 * @param {string} message - The commit message
 * @returns {{tags: string[], remaining: string}} Tags and remaining message
 */
function extractTagsFromMessage(message) {
  const tagRegex = /^(\[[\w\s-]+\])+/;
  const match = message.match(tagRegex);

  if (!match) {
    return { tags: [], remaining: message };
  }

  // Extract individual tags from the matched string
  const tagMatches = match[0].match(/\[[\w\s-]+\]/g) || [];
  const tags = tagMatches.map((tag) => tag.slice(1, -1).toLowerCase()); // Remove [ ] and lowercase
  const remaining = message.slice(match[0].length).trimStart();

  return { tags, remaining };
}

/**
 * Generates a sort key for tags to ensure consistent ordering.
 * This key is used to group commits by their starting tags.
 *
 * @param {string[]} tags - Array of tags
 * @returns {string} Sort key for the tags
 */
function generateTagSortKey(tags) {
  if (tags.length === 0) {
    return '\uFFFF'; // Sort commits without tags to the end
  }
  // Join tags with a separator that ensures proper sorting
  return tags.join('\x00');
}

/**
 * Formats changelog sections into markdown.
 *
 * @param {ChangelogSection[]} sections - Changelog sections
 * @param {ChangelogConfig} config - Changelog configuration
 * @param {Omit<import('./types.js').GenerateChangelogOptions, 'repo' | 'config'>} options - Generate changelog options
 * @param {{team: string[], community: string[], all: string[]}} contributors - Contributors
 * @returns {string} Formatted changelog markdown
 */
export function renderChangelog(sections, config, options, contributors) {
  const lines = [];

  // Add version header
  const versionTitle = templateString(config.format?.version ?? 'v{{version}}', {
    version: options.version,
  });
  lines.push(`## ${versionTitle}`);
  lines.push('');

  lines.push(`<!-- generated comparing ${options.lastRelease}...${options.release} -->`);
  lines.push('');

  // Add date
  const formattedDate = renderDate(options.date, config.format?.dateFormat ?? '_MMM DD, YYYY_');
  lines.push(formattedDate);
  lines.push('');

  /**
   * @param {string[]} list
   * @returns {string[]}
   */
  function filterContributors(list) {
    return list.filter((login) => {
      if (config.filter?.excludeAuthorsFromContributors) {
        return !config.filter.excludeAuthorsFromContributors.some((pattern) => {
          if (pattern instanceof RegExp) {
            return pattern.test(login);
          }
          return pattern === login;
        });
      }
      return true;
    });
  }
  const finalContributors = {
    team: filterContributors(contributors.team),
    community: filterContributors(contributors.community),
    all: filterContributors(contributors.all),
  };

  // Add intro if enabled
  if (config.intro) {
    renderIntro(config.intro, finalContributors, lines);
  }

  // Add contributors after intro if configured
  if (config.contributors?.addContributorsToIntro) {
    renderContributors(finalContributors, config, lines);
  }

  // Add sections
  for (const section of sections) {
    renderSection(section, config, lines);
  }

  // Add contributors at the end if not already added after intro
  if (!config.contributors?.addContributorsToIntro) {
    renderContributors(finalContributors, config, lines);
  }

  return lines.join('\n');
}

/**
 * Formats the intro section with optional thank you message and highlights placeholder.
 *
 * @param {import('./types.js').IntroConfig} introConfig - Intro configuration
 * @param {{team: string[], community: string[]}} contributors - Contributors data
 * @param {string[]} lines - Output lines array
 */
function renderIntro(introConfig, contributors, lines) {
  // Add thank you message if enabled
  if (introConfig.thanksMessage) {
    const teamCount = contributors.team.length;
    const communityCount = contributors.community.length;
    const contributorCount = teamCount + communityCount;

    lines.push(
      templateString(introConfig.thanksMessage, { contributorCount, teamCount, communityCount }),
    );
    lines.push('');
  }

  // Add highlights section if prefix is configured
  if (introConfig.highlightsPrefix) {
    lines.push(introConfig.highlightsPrefix);
    lines.push('');
  }
}

/**
 * Formats a single section.
 *
 * @param {ChangelogSection} section - Section to format
 * @param {ChangelogConfig} config - Changelog configuration
 * @param {string[]} lines - Output lines array
 * @param {ChangelogSection} [parentSection] - Parent section for recursion
 */
function renderSection(section, config, lines, parentSection) {
  // Add section header
  const heading = '#'.repeat(section.level);
  const sectionTitle = config.categorization.sections.titles?.[section.key] || section.key;
  let title =
    sectionTitle === sectionTitle.toLocaleLowerCase() ? startCase(sectionTitle) : sectionTitle;
  if (section.pkgInfo) {
    const planBadge =
      section.pkgInfo.plan && section.pkgInfo.plan !== 'base'
        ? config.format?.planBadge?.[section.pkgInfo.plan]
        : undefined;
    title = templateString(config.format?.sectionTitle?.forPackage || '{{package}}@{{version}}', {
      package: section.pkgInfo.name,
      version: section.pkgInfo.version,
      planBadge,
    });
  }

  if (!parentSection || section.key !== parentSection.key) {
    lines.push(`${heading} ${title}`);
    lines.push('');
  }

  const sortedCommits = [...section.commits].sort((a, b) => {
    // Extract tags from both commits
    const aTagData = extractTagsFromMessage(a.message);
    const bTagData = extractTagsFromMessage(b.message);

    // First sort by tag group
    const aTagKey = generateTagSortKey(aTagData.tags);
    const bTagKey = generateTagSortKey(bTagData.tags);

    if (aTagKey !== bTagKey) {
      return aTagKey.localeCompare(bTagKey);
    }

    // Then sort by merge time within the same tag group
    const aSort = a.mergedAt ? new Date(a.mergedAt).getTime() : a.prNumber;
    const bSort = b.mergedAt ? new Date(b.mergedAt).getTime() : b.prNumber;
    return aSort - bSort;
  });

  if (parentSection) {
    const isBasePlan = !section.pkgInfo?.plan || section.pkgInfo.plan === 'base';
    if (isBasePlan) {
      if (sortedCommits.length === 0 && config.format?.showInternalChangesMessage) {
        lines.push('Internal changes.');
        lines.push('');
      }
    } else {
      const planMessage =
        sortedCommits.length === 0
          ? config.format?.planMessage?.same
          : config.format?.planMessage?.plus;

      if (planMessage) {
        const planOrder = config.categorization.labels.plan.values || [];
        const currentPlan = section.pkgInfo?.plan || 'base';
        /**
         * @type {string|undefined}
         */
        let previousPlan;
        for (let i = 0; i < planOrder.length; i += 1) {
          if (planOrder[i] === currentPlan) {
            if (i > 0) {
              previousPlan = planOrder[i - 1];
            } else if (i === 0) {
              previousPlan = 'base';
            }
            break;
          }
        }

        if (previousPlan) {
          const previousPlanPkg = parentSection.subsections?.find((subsec) => {
            return subsec.pkgInfo?.plan === previousPlan;
          })?.pkgInfo;
          if (previousPlanPkg) {
            lines.push(
              templateString(planMessage, {
                previousPlan: previousPlanPkg.name,
                previousPlanVersion: previousPlanPkg.version,
                currentPlan: section.pkgInfo?.name || '',
                currentPlanVersion: section.pkgInfo?.version || '',
              }),
            );
            lines.push('');
          }
        }
      }
    }
  }

  for (const commit of sortedCommits) {
    const formattedMessage = renderCommitMessage(commit, config);
    lines.push(`- ${formattedMessage}`);
  }

  if (sortedCommits.length > 0) {
    lines.push('');
  }

  // Add subsections
  if (section.subsections) {
    for (const subsection of section.subsections) {
      renderSection(subsection, config, lines, section);
    }
  }
}

/**
 * Formats a commit message according to the configuration.
 *
 * @param {CategorizedCommit} commit - Commit to format
 * @param {ChangelogConfig} config - Changelog configuration
 * @returns {string} Formatted commit message
 */
function renderCommitMessage(commit, config) {
  // Extract only the first line of the commit message
  const rawMessage = commit.message.split('\n')[0].trim();
  // Remove component prefixes in square brackets at the start (e.g., [dialog][alert dialog])
  const cleanMessage = rawMessage.replace(/^(\[[\w\s-]+\])+\s*/i, '').replace(/\s?\(#(\d+)\)/g, '');

  const result =
    typeof config.format?.changelogMessage === 'function'
      ? config.format.changelogMessage(commit)
      : undefined;
  if (result) {
    return result;
  }
  const template =
    typeof config.format?.changelogMessage === 'string'
      ? config.format.changelogMessage
      : '{{flagPrefix}}{{message}} (#{{prNumber}})';

  const login = commit.author?.login;
  return templateString(template, {
    message: cleanMessage,
    rawMessage,
    prNumber: commit.prNumber,
    prUrl: commit.html_url,
    author: commit.author?.login || 'unknown',
    authorUrl: `https://github.com/${login}`,
    scope: commit.labels.some((label) => label.startsWith('scope:'))
      ? commit.parsed.scopes[0]
      : undefined,
    plan: commit.parsed.plan,
    flagPrefix: commit.parsed.flags
      .filter((flag) => {
        return !!config.categorization.labels.flags?.[flag]?.prefix;
      })
      .map((flag) => {
        return config.categorization.labels.flags?.[flag]?.prefix;
      })
      .reverse()
      .join(' '),
  });
}

/**
 * Formats contributors section.
 *
 * @param {{team: string[], community: string[]; all: string[]}} contributors - Contributors
 * @param {ChangelogConfig} config - Changelog configuration
 * @param {string[]} lines - Output lines array
 */
function renderContributors(contributors, config, lines) {
  if (config.contributors?.disabled === true) {
    return;
  }

  /**
   * @param {string[]} list
   * @returns {string[]}
   */
  function filterContributors(list) {
    return list.filter((login) => {
      if (config.filter?.excludeAuthorsFromContributors) {
        return !config.filter.excludeAuthorsFromContributors.some((pattern) => {
          if (pattern instanceof RegExp) {
            return pattern.test(login);
          }
          return pattern === login;
        });
      }
      return true;
    });
  }
  /**
   * @param {string[]} logins
   * @returns {string}
   */
  function renderContributorsList(logins) {
    return logins.map((login) => `@${login}`).join(', ');
  }

  /**
   *
   * @param {import('./types.js').PluralizedMessage | undefined} message
   * @param {number} count
   * @param {string} defaultTemplate
   */
  function getTemplateString(message, count, defaultTemplate) {
    let template = defaultTemplate;
    if (!message) {
      return template;
    }
    if (typeof message === 'string') {
      template = message;
    } else {
      template = count > 1 ? message.many : message.one;
    }
    return template;
  }

  const communityContributors = filterContributors(contributors.community);
  const teamContributors = filterContributors(contributors.team);
  const allContributors = filterContributors(contributors.all);
  if (communityContributors.length > 0 && config.contributors?.message?.community) {
    const template = getTemplateString(
      config.contributors.message.community,
      communityContributors.length,
      `${communityContributors.length !== 1 ? 'All community contributors of this release in alphabetical order' : 'Community contributor of this release'}: {{community}}`,
    );

    const communityMessage = templateString(template, {
      community: renderContributorsList(communityContributors),
      communityCount: communityContributors.length,
    });
    lines.push(communityMessage);
    lines.push('');
  }

  if (teamContributors.length > 0 && config.contributors?.message?.team) {
    const template = getTemplateString(
      config.contributors.message.team,
      teamContributors.length,
      `${teamContributors.length !== 1 ? 'All team contributors of this release in alphabetical order' : 'Team contributor of this release'}: {{team}}`,
    );
    const teamMessage = templateString(template, {
      team: renderContributorsList(teamContributors),
      teamCount: teamContributors.length,
    });
    lines.push(teamMessage);
    lines.push('');
  }

  if (
    config.contributors?.message?.contributors ||
    !(config.contributors?.message?.community && config.contributors?.message?.team)
  ) {
    const template = getTemplateString(
      config.contributors?.message?.contributors,
      allContributors.length,
      `${allContributors.length !== 1 ? 'All contributors of this release in alphabetical order' : 'Contributor of this release'} : {{contributors}}`,
    );
    const contributorsMessage = templateString(template, {
      contributors: renderContributorsList(allContributors),
      contributorsCount: allContributors.length,
      team: renderContributorsList(teamContributors),
      teamCount: teamContributors.length,
      community: renderContributorsList(communityContributors),
      communityCount: communityContributors.length,
    });
    lines.push(contributorsMessage);
    lines.push('');
  }
}

/**
 * Formats a date according to the format string. Naive implementation.
 *
 * @param {Date} date - Date to format
 * @param {string} format - Date format string
 * @returns {string} Formatted date
 */
function renderDate(date, format) {
  // Simple date formatting supporting "MMM DD, YYYY"
  const month = MONTH_NAMES[date.getMonth()];
  const fullMonth = FULL_MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  let formatted = format;
  const dayPadded = day.toString().padStart(2, '0');
  formatted = formatted.replace('MMMM', fullMonth);
  formatted = formatted.replace('MMM', month);
  formatted = formatted.replace('DD', dayPadded);
  formatted = formatted.replace('YYYY', year.toString());

  return formatted;
}

/**
 * Extracts contributors from all commits, excluding only those matching excludeAuthors.
 * This is used to credit all contributors, even if their commits were filtered out
 * for other reasons (like missing labels or being in excludeLabels).
 *
 * @param {import('./types.js').FetchedCommitDetails[]} allCommits - All fetched commits
 * @param {(string|RegExp)[]} [excludeAuthors] - Author patterns to exclude (e.g., ['[bot]'])
 * @returns {{team: string[], community: string[]; all: string[]}} Contributors grouped by type
 */
export function extractContributorsFromAllCommits(allCommits, excludeAuthors = []) {
  /** @type {Set<string>} */
  const teamSet = new Set();
  /** @type {Set<string>} */
  const communitySet = new Set();

  for (const commit of allCommits) {
    if (!commit.author) {
      continue;
    }

    const { login, association } = commit.author;

    // Check if author should be excluded
    let shouldExclude = false;
    if (excludeAuthors.length > 0) {
      for (const pattern of excludeAuthors) {
        if (pattern instanceof RegExp && pattern.test(login)) {
          shouldExclude = true;
          break;
        } else if (typeof pattern === 'string' && login === pattern) {
          shouldExclude = true;
          break;
        }
      }
    }

    if (shouldExclude) {
      continue;
    }

    if (association === 'team') {
      teamSet.add(login);
    } else {
      communitySet.add(login);
    }
  }

  const result = {
    team: Array.from(teamSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    community: Array.from(communitySet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
    all: /** @type {string[]} */ ([]),
  };
  result.all = [...result.team, ...result.community].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

  return result;
}
