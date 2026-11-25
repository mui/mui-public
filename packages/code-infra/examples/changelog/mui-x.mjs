import {
  bulletList,
  creditAuthors,
  formatAuthor,
  formatDate,
  formatReference,
  groupBy,
  joinBlocks,
  joinWords,
  labelValues,
  mapPrefixes,
  matchPrefix,
  parseTitle,
  readLabels,
  section,
  sortByTitle,
} from '../../src/changelog/index.mjs';

/**
 * @typedef {import('../../src/changelog/index.mjs').ChangelogChange} ChangelogChange
 * @typedef {import('../../src/changelog/index.mjs').ChangelogData} ChangelogData
 * @typedef {'pro' | 'premium'} Plan
 * @typedef {{ title: string, scope: string, base: string, plans?: Plan[], companions?: string[], internal?: boolean }} Product
 */

const EXCLUDED_LABELS = ['dependencies', 'release'];
const EXCLUDED_CONTRIBUTORS = ['renovate[bot]', 'code-infra-renovate[bot]', 'github-actions[bot]'];
// Internal to the products, and not a place in the changelog.
const IGNORED_LABELS = ['scope: virtualizer'];

/** @type {Product[]} */
const PRODUCTS = [
  {
    title: 'Data Grid',
    scope: 'data grid',
    base: '@mui/x-data-grid',
    plans: ['pro', 'premium'],
  },
  { title: 'Date and Time Pickers', scope: 'pickers', base: '@mui/x-date-pickers', plans: ['pro'] },
  {
    title: 'Charts',
    scope: 'charts',
    base: '@mui/x-charts',
    plans: ['pro', 'premium'],
    companions: ['@mui/x-charts-vendor'],
  },
  { title: 'Tree View', scope: 'tree view', base: '@mui/x-tree-view', plans: ['pro'] },
  { title: 'Scheduler', scope: 'scheduler', base: '@mui/x-scheduler', plans: ['premium'] },
  {
    title: 'Chat',
    scope: 'chat',
    base: '@mui/x-chat',
    companions: ['@mui/x-chat-headless'],
  },
  { title: 'Codemod', scope: 'codemod', base: '@mui/x-codemod', internal: true },
];

const GRID = 'scope: data grid';
const PICKERS = 'scope: pickers';
const CHARTS = 'scope: charts';
const TREE_VIEW = 'scope: tree view';
const SCHEDULER = 'scope: scheduler';
const CHAT = 'scope: chat';
const PRO = 'plan: Pro';
const PREMIUM = 'plan: Premium';

/** The prefixes as the changelog spells them, and the labels they stand for. */
const PREFIXES = {
  DataGrid: [GRID],
  DataGridPro: [GRID, PRO],
  DataGridPremium: [GRID, PREMIUM],
  pickers: [PICKERS],
  fields: [PICKERS],
  DatePicker: [PICKERS],
  TimePicker: [PICKERS],
  DateTimePicker: [PICKERS],
  DateRangeCalendar: [PICKERS, PRO],
  DateRangePicker: [PICKERS, PRO],
  DateTimeRangePicker: [PICKERS, PRO],
  TimeRangePicker: [PICKERS, PRO],
  charts: [CHARTS],
  'charts-pro': [CHARTS, PRO],
  'charts-premium': [CHARTS, PREMIUM],
  'tree view': [TREE_VIEW],
  RichTreeView: [TREE_VIEW],
  TreeItem: [TREE_VIEW],
  'tree view pro': [TREE_VIEW, PRO],
  RichTreeViewPro: [TREE_VIEW, PRO],
  scheduler: [SCHEDULER],
  'scheduler-premium': [SCHEDULER, PREMIUM],
  chat: [CHAT],
  'x-chat': [CHAT],
  'chat-headless': [CHAT],
  codemod: ['scope: codemod'],
  docs: [],
  internal: ['internal'],
  'code-infra': ['scope: code-infra'],
  'docs-infra': ['scope: docs-infra'],
  'support-infra': ['scope: support-infra'],
  infra: ['scope: code-infra'],
  core: ['internal'],
  test: [],
  l10n: [],
};
const SPELLINGS = Object.keys(PREFIXES);

const CORE_LABELS = ['internal', 'scope: code-infra', 'scope: docs-infra', 'scope: support-infra'];

const PLAN_BADGES = {
  pro: "[![pro](https://mui.com/r/x-pro-svg)](https://mui.com/r/x-pro-svg-link 'Pro plan')",
  premium:
    "[![premium](https://mui.com/r/x-premium-svg)](https://mui.com/r/x-premium-svg-link 'Premium plan')",
};

/**
 * @param {Product} product
 * @param {string[]} labels
 */
function getPackage(product, labels) {
  const plans = labelValues(labels, 'plan').map((plan) => plan.toLowerCase());
  const plan = product.plans?.find((candidate) => plans.includes(candidate));
  return plan ? `${product.base}-${plan}` : product.base;
}

/**
 * The packages and other sections that list a change.
 *
 * @param {ChangelogChange} change
 * @returns {string[]}
 */
function getDestinations(change) {
  const ownLabels = change.labels.filter((label) => !IGNORED_LABELS.includes(label));
  const labels = readLabels({ title: change.title, labels: ownLabels }, PREFIXES);
  const { prefixes } = parseTitle(change.title);
  if (prefixes.includes('docs')) {
    return ['Docs'];
  }
  if (prefixes.includes('test')) {
    return ['Miscellaneous'];
  }

  const scopes = labelValues(labels, 'scope');
  const products = PRODUCTS.filter((product) => scopes.includes(product.scope));
  if (products.length === 0) {
    return [labels.some((label) => CORE_LABELS.includes(label)) ? 'Core' : 'Miscellaneous'];
  }

  const description = [change.message, change.pullRequest?.body].join('\n');
  return products.flatMap((product) => [
    getPackage(
      product,
      // In a change to several products, the plan of one says nothing about the others.
      products.length === 1
        ? labels
        : prefixes.flatMap((prefix) => {
            const meaning = readLabels({ title: `[${prefix}]`, labels: [] }, PREFIXES);
            return meaning.includes(`scope: ${product.scope}`) ? meaning : [];
          }),
    ),
    ...(product.companions ?? []).filter((name) =>
      new RegExp(`(?:@mui|packages)/${name.slice('@mui/'.length)}(?![\\w-])`).test(description),
    ),
  ]);
}

/**
 * @param {ChangelogChange[]} [changes]
 */
function changeList(changes = []) {
  return bulletList(
    sortByTitle(changes).map((change) =>
      joinWords(change.title, `(${formatReference(change)})`, formatAuthor(change.author)),
    ),
  );
}

/**
 * @param {ChangelogData} data
 * @param {Map<string, ChangelogChange[]>} groups
 * @param {Product} product
 */
function formatProduct(data, groups, { title, base, plans = [], companions = [], internal }) {
  const tiers = [base, ...plans.map((plan) => `${base}-${plan}`)];
  const isListed = [...tiers, ...companions].some((name) => groups.has(name));
  const versions = new Map(data.packages.map((pkg) => [pkg.name, pkg]));
  // Internal changes, such as a bump of a shared dependency, are released too. It isn't known
  // whether there are any without the previous release.
  const isReleased = versions.has(base) && versions.get(base)?.changed !== false;
  if (!isListed && (internal || !isReleased)) {
    return '';
  }

  const at = (/** @type {string} */ name) =>
    `\`${name}@${versions.get(name)?.version ?? data.version}\``;
  return section(
    `### ${title}`,
    section(`#### ${at(base)}`, changeList(groups.get(base)) || 'Internal changes.'),
    plans.map((plan, index) => {
      const changes = changeList(groups.get(tiers[index + 1]));
      return section(
        `#### ${at(tiers[index + 1])} ${PLAN_BADGES[plan]}`,
        `Same changes as in ${at(tiers[index])}${changes ? ', plus:' : '.'}`,
        changes,
      );
    }),
    companions.map((name) => section(`#### ${at(name)}`, changeList(groups.get(name)))),
  );
}

/**
 * @param {ChangelogChange[]} changes
 */
function formatContributors(changes) {
  const { all, team, community } = creditAuthors(changes, { exclude: EXCLUDED_CONTRIBUTORS });
  const names = (/** @type {typeof all} */ authors) => authors.map(formatAuthor).join(', ');
  return joinBlocks(
    `We'd like to extend a big thank you to the ${all.length} ${all.length === 1 ? 'contributor' : 'contributors'} who made this release possible. Here are some highlights ✨:`,
    'TODO INSERT HIGHLIGHTS',
    community.length > 1 &&
      `Special thanks go out to these community members for their valuable contributions:\n${names(community)}`,
    community.length === 1 &&
      `Special thanks go out to community member ${names(community)} for their valuable contribution.`,
    team.length > 0 && `The following team members contributed to this release:\n${names(team)}`,
  );
}

/**
 * @param {ChangelogData} data
 */
export function formatChangelog(data) {
  const changes = data.changes
    .filter((change) => !change.labels.some((label) => EXCLUDED_LABELS.includes(label)))
    .map((change) => ({
      ...change,
      title: mapPrefixes(change.title, (prefix) => matchPrefix(prefix, SPELLINGS) ?? prefix),
    }));
  const groups = groupBy(changes, getDestinations);

  return joinBlocks(
    `## ${data.version}`,
    `<!-- generated comparing ${data.previous.ref}..${data.release.ref} -->`,
    `_${formatDate(data.date)}_`,
    formatContributors(changes),
    PRODUCTS.map((product) => formatProduct(data, groups, product)),
    ['Docs', 'Core', 'Miscellaneous'].map((title) =>
      section(`### ${title}`, changeList(groups.get(title))),
    ),
  );
}
