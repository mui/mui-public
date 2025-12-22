/**
 * @typedef {import('./types.ts').ChangelogSection} ChangelogSection
 * @typedef {import('./types.ts').CategorizedCommit} CategorizedCommit
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 * @typedef {import('./types.ts').GenerateChangelogResult} GenerateChangelogResult
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
 * Formats changelog sections into markdown.
 *
 * @param {ChangelogSection[]} sections - Changelog sections
 * @param {ChangelogConfig} config - Changelog configuration
 * @param {string} version - Version string
 * @param {Date} date - Release date
 * @param {{team: string[], community: string[]}} contributors - Contributors
 * @returns {string} Formatted changelog markdown
 */
export function formatChangelog(sections, config, version, date, contributors) {
  const lines = [];

  // Add version header
  const versionTitle = config.format.version.replace('{version}', version);
  lines.push(`## ${versionTitle}`);
  lines.push('');

  // Add date
  const formattedDate = formatDate(date, config.format.dateFormat ?? 'MMM DD, YYYY');
  lines.push(`_${formattedDate}_`);
  lines.push('');

  // Add intro if enabled
  if (config.intro?.enabled) {
    formatIntro(config.intro, contributors, lines);
  }

  // Add contributors after intro if configured
  if (config.contributors?.enabled && config.contributors.addContributorsToIntro) {
    formatContributors(contributors, config, lines);
  }

  // Add sections
  for (const section of sections) {
    formatSection(section, config, lines);
  }

  // Add contributors at the end if not already added after intro
  if (config.contributors?.enabled && !config.contributors.addContributorsToIntro) {
    formatContributors(contributors, config, lines);
  }

  return lines.join('\n');
}

/**
 * Formats the intro section with optional thank you message and highlights placeholder.
 *
 * @param {import('./types.ts').IntroConfig} introConfig - Intro configuration
 * @param {{team: string[], community: string[]}} contributors - Contributors data
 * @param {string[]} lines - Output lines array
 */
function formatIntro(introConfig, contributors, lines) {
  // Add thank you message if enabled
  if (introConfig.thanksMessage && typeof introConfig.thanksMessage === 'string') {
    const teamCount = contributors.team.length;
    const communityCount = contributors.community.length;
    const contributorCount = teamCount + communityCount;

    let message = introConfig.thanksMessage;
    message = message.replace('{contributorCount}', contributorCount.toString());
    message = message.replace('{teamCount}', teamCount.toString());
    message = message.replace('{communityCount}', communityCount.toString());

    lines.push(message);
    lines.push('');
  }

  // Add highlights section if prefix is configured
  if (introConfig.highlightsPrefix) {
    lines.push(introConfig.highlightsPrefix);
    lines.push('');
    lines.push('<!-- Highlights placeholder - manually add key features/changes here -->');
    lines.push('<!-- Example:');
    lines.push('- 🚀 New feature: Description of feature');
    lines.push('- ⚡ Performance: Description of improvement');
    lines.push('- 🐛 Bug fix: Description of fix');
    lines.push('-->');
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
function formatSection(section, config, lines, parentSection) {
  // Add section header
  const heading = '#'.repeat(section.level);
  const title = section.badge ? `${section.title} ${section.badge}` : section.title;

  if (!parentSection || section.title !== parentSection.title) {
    lines.push(`${heading} ${title}`);
    lines.push('');
  }

  // Check if this section has internal changes only
  if (section.internalChangesOnly) {
    lines.push('Internal changes.');
    lines.push('');
  } else {
    // Add inheritance message if applicable
    if (section.inheritance) {
      const message =
        section.inheritance.type === 'same'
          ? config.planInheritance?.messages.same
          : config.planInheritance?.messages.plus;

      if (message) {
        const formattedMessage = message.replace('{basePackage}', section.inheritance.from);
        lines.push(formattedMessage);
        lines.push('');
      }
    }

    // Add commits (sorted by PR number ascending - oldest first)
    if (section.commits.length > 0) {
      const sortedCommits = [...section.commits].sort((a, b) => a.prNumber - b.prNumber);
      for (const commit of sortedCommits) {
        const formattedMessage = formatCommitMessage(commit, config);
        lines.push(`- ${formattedMessage}`);
      }
      lines.push('');
    }
  }

  // Add subsections
  if (section.subsections) {
    for (const subsection of section.subsections) {
      formatSection(subsection, config, lines, section);
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
function formatCommitMessage(commit, config) {
  // Extract only the first line of the commit message
  let message = commit.message.split('\n')[0].trim();
  // Remove component prefixes in square brackets at the start (e.g., [dialog][alert dialog])
  message = message.replace(/^(\[[\w\s-]+\])+\s*/i, '');

  // Check if this is a breaking change
  const isBreaking = commit.parsed.flags.includes(config.categorization.labels.breaking.value);

  if (config.formatting.messageFormat === 'breaking-inline') {
    // Base UI style: **Breaking change:** prefix for breaking changes
    if (isBreaking && config.formatting.breakingChange) {
      const prefix = config.formatting.breakingChange.prefix;
      message = `${prefix} ${message}`;
    }
  } else if (config.formatting.messageFormat === 'component-prefix') {
    // MUI X style: [Component] prefix
    // Use the first component if multiple components exist
    const firstComponent = commit.parsed.components[0];
    if (config.formatting.componentPrefix?.enabled && firstComponent) {
      const componentName = getComponentDisplayName(
        firstComponent,
        config.categorization.componentNameMapping,
      );
      const prefix = config.formatting.componentPrefix.format.replace('{component}', componentName);
      message = `${prefix} ${message}`;
    }
  }

  // Add PR and author attribution
  const attribution = formatAttribution(commit, config.formatting.prAuthorFormat);
  message = `${message} ${attribution}`;

  return message;
}

/**
 * Gets the display name for a component.
 *
 * @param {string} component - Component label value
 * @param {Record<string, string>} [mapping] - Optional component name mapping
 * @returns {string} Display name for component
 */
function getComponentDisplayName(component, mapping) {
  if (mapping && mapping[component]) {
    return mapping[component];
  }
  // Keep as-is if no mapping
  return component;
}

/**
 * Formats PR and author attribution.
 *
 * @param {CategorizedCommit} commit - Commit with author info
 * @param {string} format - Attribution format string
 * @returns {string} Formatted attribution
 */
function formatAttribution(commit, format) {
  let attribution = format;
  attribution = attribution.replace('{pr}', commit.prNumber.toString());
  attribution = attribution.replace('{author}', commit.author?.login || 'unknown');
  return attribution;
}

/**
 * Formats contributors section.
 *
 * @param {{team: string[], community: string[]}} contributors - Contributors
 * @param {ChangelogConfig} config - Changelog configuration
 * @param {string[]} lines - Output lines array
 */
function formatContributors(contributors, config, lines) {
  if (!config.contributors) {
    return;
  }

  if (config.contributors.splitByType) {
    // split community and team
    if (contributors.community.length > 0) {
      if (contributors.community.length === 1) {
        lines.push(
          `Special thanks go out to community member @${contributors.community[0]} for their valuable contribution.`,
        );
      } else {
        lines.push(
          `Special thanks go out to these community members for their valuable contributions:\n${contributors.community.map((name) => `@${name}`).join(', ')}`,
        );
      }
      lines.push('');
    }

    if (contributors.team.length > 0) {
      lines.push('The following team member(s) contributed to this release:');
      lines.push(contributors.team.map((name) => `@${name}`).join(', '));
      lines.push('');
    }
  } else {
    // all contributors together
    const allContributors = [...contributors.community, ...contributors.team].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    if (allContributors.length > 0) {
      const message =
        config.contributors.message ||
        'All contributors of this release in alphabetical order: {contributors}';
      const formatted = message.replace(
        '{contributors}',
        allContributors.map((name) => `@${name}`).join(', '),
      );
      lines.push(formatted);
      lines.push('');
    }
  }
}

/**
 * Formats a date according to the format string.
 *
 * @param {Date} date - Date to format
 * @param {string} format - Date format string
 * @returns {string} Formatted date
 */
function formatDate(date, format) {
  // Simple date formatting supporting "MMM DD, YYYY"
  const month = MONTH_NAMES[date.getMonth()];
  const fullMonth = FULL_MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  let formatted = format;
  formatted = formatted.replace('MMMM', fullMonth);
  formatted = formatted.replace('MMM', month);
  formatted = formatted.replace('DD', day.toString());
  formatted = formatted.replace('YYYY', year.toString());

  return formatted;
}

/**
 * Extracts contributors from all commits, excluding only those matching excludeAuthors.
 * This is used to credit all contributors, even if their commits were filtered out
 * for other reasons (like missing labels or being in excludeLabels).
 *
 * @param {import('./types.ts').FetchedCommitDetails[]} allCommits - All fetched commits
 * @param {(string|RegExp)[]} [excludeAuthors] - Author patterns to exclude (e.g., ['[bot]'])
 * @returns {{team: string[], community: string[]}} Contributors grouped by type
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

  return {
    team: Array.from(teamSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    community: Array.from(communitySet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    ),
  };
}
