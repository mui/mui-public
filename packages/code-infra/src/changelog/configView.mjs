import { startCase } from 'es-toolkit/string';
import { templateString } from '../utils/template.mjs';
import { buildSections } from './buildSections.mjs';
import { categorizeCommits } from './categorizeCommits.mjs';
import { filterCommits } from './filterCommits.mjs';
import { sortSections } from './sortSections.mjs';
import { formatDate, md } from './md.mjs';

/**
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 * @typedef {import('./types.ts').ChangelogSection} ChangelogSection
 * @typedef {import('./types.ts').CategorizedCommit} CategorizedCommit
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').ReleaseEntry} ReleaseEntry
 * @typedef {import('./types.ts').ChangelogRelease} ChangelogRelease
 * @typedef {{ team: string[]; community: string[]; all: string[] }} Credits
 * @typedef {{ release: ChangelogRelease; sections: ChangelogSection[]; contributors: Credits }} ConfigPrepared
 */

/** @type {Record<string, 'team' | 'contributor' | 'first_timer'>} */
const ASSOCIATIONS = { team: 'team', community: 'contributor', 'first-timer': 'first_timer' };

/**
 * The changelog config format as a preset: categorization and layout come from `config`.
 *
 * @param {ChangelogConfig} config
 * @returns {import('./types.ts').ChangelogPreset<ConfigPrepared>}
 */
export function configView(config) {
  return {
    prepare(facts) {
      const commits = filterCommits(facts.entries.flatMap(toCommit), config.filter);
      // Credit authors of every kept commit, including those no section shows.
      const contributors = extractContributors(commits, config.filter?.excludeCommitByAuthors);

      const versions = new Map(
        facts.packages.flatMap((pkg) => (pkg.private ? [] : [[pkg.name, pkg.version ?? '']])),
      );

      const categories = categorizeCommits(commits, config.categorization);

      const sections = sortSections(
        buildSections(categories, config.categorization, versions),
        config.categorization,
      );

      const release = {
        lastRelease: facts.lastRelease,
        release: facts.release,
        version: facts.version,
        date: new Date(facts.date),
      };

      return { release, sections, contributors };
    },
    view: (prepared) => renderConfig(config, prepared),
  };
}

/**
 * @param {ReleaseEntry} entry
 * @returns {FetchedCommitDetails[]}
 */
function toCommit(entry) {
  if (entry.pr === null) {
    return [];
  }

  return [
    {
      sha: entry.sha,
      message: entry.message,
      labels: [...entry.labels],
      prNumber: entry.pr,
      html_url: entry.url,
      author: entry.author?.login
        ? { login: entry.author.login, association: ASSOCIATIONS[entry.author.association] }
        : null,
      mergedAt: entry.mergedAt,
      createdAt: entry.createdAt,
      prTitle: entry.prTitle,
      prBody: entry.body,
    },
  ];
}

/**
 * @param {(string | RegExp)[] | undefined} patterns
 * @param {string} login
 */
function isExcluded(patterns, login) {
  return (patterns ?? []).some((pattern) =>
    pattern instanceof RegExp ? pattern.test(login) : pattern === login,
  );
}

/** @param {string} a @param {string} b */
function byLogin(a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

/**
 * @param {FetchedCommitDetails[]} commits
 * @param {(string | RegExp)[]} [exclude]
 * @returns {Credits}
 */
function extractContributors(commits, exclude) {
  /** @type {Set<string>} */
  const team = new Set();
  /** @type {Set<string>} */
  const community = new Set();

  for (const commit of commits) {
    if (!commit.author || isExcluded(exclude, commit.author.login)) {
      continue;
    }

    (commit.author.association === 'team' ? team : community).add(commit.author.login);
  }

  const result = { team: [...team].sort(byLogin), community: [...community].sort(byLogin) };

  return { ...result, all: [...result.team, ...result.community].sort(byLogin) };
}

/**
 * @param {ChangelogConfig} config
 * @param {ConfigPrepared} prepared
 * @returns {string}
 */
function renderConfig(config, { release, sections, contributors }) {
  const exclude = config.filter?.excludeAuthorsFromContributors;
  /** @param {string[]} list */
  const credited = (list) => list.filter((login) => !isExcluded(exclude, login));

  const shown = {
    team: credited(contributors.team),
    community: credited(contributors.community),
    all: credited(contributors.all),
  };

  const intro = config.intro;

  const counts = {
    contributorCount: shown.team.length + shown.community.length,
    teamCount: shown.team.length,
    communityCount: shown.community.length,
  };

  const credits = renderContributors(config, shown);
  const early = config.contributors?.addContributorsToIntro;

  return md`
## ${templateString(config.format?.version ?? 'v{{version}}', { version: release.version })}

<!-- generated comparing ${release.lastRelease}...${release.release} -->

${formatDate(release.date, config.format?.dateFormat)}

${intro?.thanksMessage && templateString(intro.thanksMessage, counts)}

${intro?.highlightsPrefix}

${early && credits}

${sections.map((section) => renderSection(config, section))}

${!early && credits}
`;
}

/**
 * @param {ChangelogConfig} config
 * @param {ChangelogSection} section
 * @param {ChangelogSection} [parent]
 * @returns {string[]}
 */
function renderSection(config, section, parent) {
  const blocks = [];
  const key = config.categorization.sections.titles?.[section.key] || section.key;
  let title = key === key.toLocaleLowerCase() ? startCase(key) : key;

  if (section.pkgInfo) {
    const plan = section.pkgInfo.plan;
    title = templateString(config.format?.sectionTitle?.forPackage || '{{package}}@{{version}}', {
      package: section.pkgInfo.name,
      version: section.pkgInfo.version,
      planBadge: plan && plan !== 'base' ? config.format?.planBadge?.[plan] : undefined,
    });
  }

  if (!parent || section.key !== parent.key) {
    blocks.push(`${'#'.repeat(section.level)} ${title}`);
  }

  const commits = sortByTags(section.commits);

  if (parent) {
    blocks.push(planMessage(config, section, parent, commits.length));
  }

  blocks.push(commits.map((commit) => `- ${renderCommit(config, commit)}`).join('\n'));

  for (const subsection of section.subsections ?? []) {
    blocks.push(...renderSection(config, subsection, section));
  }

  return blocks;
}

/**
 * @param {ChangelogConfig} config
 * @param {ChangelogSection} section
 * @param {ChangelogSection} parent
 * @param {number} count
 */
function planMessage(config, section, parent, count) {
  const plan = section.pkgInfo?.plan || 'base';

  if (plan === 'base') {
    return count === 0 && config.format?.showInternalChangesMessage ? 'Internal changes.' : '';
  }

  const message = count === 0 ? config.format?.planMessage?.same : config.format?.planMessage?.plus;

  if (!message) {
    return '';
  }

  const plans = config.categorization.labels.plan.values || [];
  const index = plans.indexOf(plan);
  const previousPlan = index > 0 ? plans[index - 1] : index === 0 && 'base';
  const previous = parent.subsections?.find((sub) => sub.pkgInfo?.plan === previousPlan)?.pkgInfo;

  if (!previousPlan || !previous) {
    return '';
  }

  return templateString(message, {
    previousPlan: previous.name,
    previousPlanVersion: previous.version,
    currentPlan: section.pkgInfo?.name || '',
    currentPlanVersion: section.pkgInfo?.version || '',
  });
}

/** @param {string} message */
function tagKey(message) {
  const match = message.match(/^(\[[\w\s-]+\])+/);

  if (!match) {
    return '￿';
  }

  return (match[0].match(/\[[\w\s-]+\]/g) ?? [])
    .map((tag) => tag.slice(1, -1).toLowerCase())
    .join('\x00');
}

/** @param {CategorizedCommit[]} commits */
function sortByTags(commits) {
  /** @param {CategorizedCommit} commit */
  const time = (commit) =>
    commit.mergedAt ? new Date(commit.mergedAt).getTime() : commit.prNumber;

  return [...commits].sort(
    (a, b) => tagKey(a.message).localeCompare(tagKey(b.message)) || time(a) - time(b),
  );
}

/**
 * @param {ChangelogConfig} config
 * @param {CategorizedCommit} commit
 */
function renderCommit(config, commit) {
  const rawMessage = commit.message.split('\n')[0].trim();
  const message = rawMessage.replace(/^(\[[\w\s-]+\])+\s*/i, '').replace(/\s?\(#(\d+)\)/g, '');
  const format = config.format?.changelogMessage;
  const custom = typeof format === 'function' ? format(commit) : undefined;

  if (custom) {
    return custom;
  }

  const flags = config.categorization.labels.flags;

  return templateString(
    typeof format === 'string' ? format : '{{flagPrefix}}{{message}} (#{{prNumber}})',
    {
      message,
      rawMessage,
      prNumber: commit.prNumber,
      prUrl: commit.html_url,
      author: commit.author?.login || 'unknown',
      authorUrl: `https://github.com/${commit.author?.login}`,
      scope: commit.labels.some((label) => label.startsWith('scope:'))
        ? commit.parsed.scopes[0]
        : undefined,
      plan: commit.parsed.plan,
      flagPrefix: commit.parsed.flags
        .filter((flag) => !!flags?.[flag]?.prefix)
        .map((flag) => flags?.[flag]?.prefix)
        .reverse()
        .join(' '),
    },
  );
}

/**
 * @param {import('./types.ts').PluralizedMessage | undefined} message
 * @param {number} count
 * @param {string} fallback
 */
function pluralized(message, count, fallback) {
  if (!message) {
    return fallback;
  }

  return typeof message === 'string' ? message : message[count > 1 ? 'many' : 'one'];
}

/**
 * @param {ChangelogConfig} config
 * @param {Credits} shown
 * @returns {string[]}
 */
function renderContributors(config, shown) {
  if (config.contributors?.disabled === true) {
    return [];
  }

  const messages = config.contributors?.message;
  /** @param {string[]} logins */
  const list = (logins) => logins.map((login) => `@${login}`).join(', ');
  const blocks = [];

  if (shown.community.length > 0 && messages?.community) {
    const count = shown.community.length;
    const fallback = `${count !== 1 ? 'All community contributors of this release in alphabetical order' : 'Community contributor of this release'}: {{community}}`;
    blocks.push(
      templateString(pluralized(messages.community, count, fallback), {
        community: list(shown.community),
        communityCount: count,
      }),
    );
  }

  if (shown.team.length > 0 && messages?.team) {
    const count = shown.team.length;
    const fallback = `${count !== 1 ? 'All team contributors of this release in alphabetical order' : 'Team contributor of this release'}: {{team}}`;
    blocks.push(
      templateString(pluralized(messages.team, count, fallback), {
        team: list(shown.team),
        teamCount: count,
      }),
    );
  }

  if (messages?.contributors || !(messages?.community && messages?.team)) {
    const count = shown.all.length;
    const fallback = `${count !== 1 ? 'All contributors of this release in alphabetical order' : 'Contributor of this release'}: {{contributors}}`;
    blocks.push(
      templateString(pluralized(messages?.contributors, count, fallback), {
        contributors: list(shown.all),
        contributorsCount: count,
        team: list(shown.team),
        teamCount: shown.team.length,
        community: list(shown.community),
        communityCount: shown.community.length,
      }),
    );
  }

  return blocks;
}
