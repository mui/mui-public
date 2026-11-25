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
 */

const EXCLUDED_CONTRIBUTORS = ['github-actions[bot]'];
const BREAKING_CHANGE = 'breaking change';

const PACKAGES = [
  '@mui/material',
  '@mui/icons-material',
  '@mui/system',
  '@mui/utils',
  '@mui/types',
  '@mui/lab',
  '@mui/codemod',
  '@mui/material-nextjs',
  '@mui/styled-engine',
  '@mui/styled-engine-sc',
  '@mui/private-theming',
  '@mui/material-pigment-css',
  '@mui/stylis-plugin-rtl',
  '@mui/envinfo',
];

/** What isn't a component or the name of a package. */
const SECTIONS = {
  'material-ui': '@mui/material',
  l10n: '@mui/material',
  styles: '@mui/material',
  theme: '@mui/material',
  'focus trap': '@mui/material',
  hidden: '@mui/material',
  progress: '@mui/material',
  'transfer list': '@mui/material',
  transitions: '@mui/material',
  icons: '@mui/icons-material',
  'material-icons': '@mui/icons-material',
  docs: 'Docs',
  blog: 'Core',
  'code-infra': 'Core',
  'core-docs': 'Core',
  'docs-infra': 'Core',
  'support-infra': 'Core',
  infra: 'Core',
  internal: 'Core',
  ci: 'Core',
  core: 'Core',
  agents: 'Core',
  test: 'Core',
};

/**
 * @param {Record<string, string>} components - The package of each component
 */
function createRouter(components) {
  /** @type {Record<string, string>} */
  const sections = {
    ...components,
    ...Object.fromEntries(PACKAGES.map((name) => [name.slice('@mui/'.length), name])),
    ...SECTIONS,
  };
  const names = Object.keys(sections);
  const findSection = (/** @type {string} */ name) =>
    sections[matchPrefix(name, names) ?? ''] ?? null;

  const titleLabels = Object.fromEntries(names.map((name) => [name, [`scope: ${name}`]]));

  return (/** @type {ChangelogChange} */ change) => {
    const titleSections = parseTitle(change.title).prefixes.map(findSection);
    const other = ['Docs', 'Core'].find((name) => titleSections.includes(name));
    if (other) {
      return other;
    }

    // Three kinds of labels that all say where a change belongs.
    const ownLabels = change.labels.map((label) =>
      label.replace(/^(package|component):/, 'scope:'),
    );
    const labels = readLabels({ title: change.title, labels: ownLabels }, titleLabels);
    const scopes = labelValues(labels, 'scope').filter(findSection);
    const packages = scopes.filter((scope) => PACKAGES.includes(`@mui/${scope}`));
    const found = (packages.length > 0 ? packages : scopes).flatMap(
      (scope) => findSection(scope) ?? [],
    );
    if (found.length > 0) {
      return found;
    }
    return labels.includes('docs') ? 'Docs' : 'Core';
  };
}

/**
 * @param {ChangelogChange} change
 */
function isListed({ title, labels, author }) {
  // People update dependencies too, when it takes more than a bump.
  const isBump = labels.includes('dependencies') && author?.login?.endsWith('[bot]');
  return !isBump && !labels.includes('release') && !parseTitle(title).prefixes.includes('website');
}

/**
 * The prefixes that say more than the section does, in the spelling of the changelog.
 *
 * @param {string} title
 * @param {string} heading
 */
function formatTitle(title, heading) {
  const redundant = [heading.replace('@mui/', ''), 'material-ui', 'icons'];
  return mapPrefixes(title, (prefix) => {
    if (heading !== 'Core' && matchPrefix(prefix, redundant)) {
      return '';
    }
    return prefix.toLowerCase().replaceAll(' ', '');
  });
}

/**
 * @param {ChangelogChange[]} changes
 * @param {string} heading
 */
function changeList(changes, heading) {
  return bulletList(
    sortByTitle(
      changes.map((change) => ({ ...change, title: formatTitle(change.title, heading) })),
    ).map((change) =>
      joinWords(change.title, `(${formatReference(change)})`, formatAuthor(change.author)),
    ),
  );
}

/**
 * @param {ChangelogChange[]} changes
 * @param {string} heading
 */
function formatChanges(changes, heading) {
  const isBreaking = (/** @type {ChangelogChange} */ change) =>
    change.labels.includes(BREAKING_CHANGE);
  const breaking = changeList(changes.filter(isBreaking), heading);
  const other = changeList(
    changes.filter((change) => !isBreaking(change)),
    heading,
  );
  return breaking
    ? joinBlocks(section('#### Breaking Changes', breaking), section('#### Changes', other))
    : other;
}

/**
 * @param {ChangelogData} data
 * @param {Record<string, string>} components - The package of each component
 */
export function formatChangelog(data, components) {
  const changes = data.changes.filter(isListed);
  const groups = groupBy(changes, createRouter(components));
  const { all } = creditAuthors(changes, { exclude: EXCLUDED_CONTRIBUTORS });
  const versions = new Map(data.packages.map(({ name, version }) => [name, version]));

  return joinBlocks(
    `## ${data.version}`,
    `<!-- generated comparing ${data.previous.ref}..${data.release.ref} -->`,
    `_${formatDate(data.date)}_`,
    `A big thanks to the ${all.length} ${all.length === 1 ? 'contributor' : 'contributors'} who made this release possible. Here are some highlights ✨:`,
    'TODO INSERT HIGHLIGHTS',
    PACKAGES.map((name) =>
      section(
        `### \`${name}@${versions.get(name) ?? data.version}\``,
        formatChanges(groups.get(name) ?? [], name),
      ),
    ),
    ['Docs', 'Core'].map((title) =>
      section(`### ${title}`, formatChanges(groups.get(title) ?? [], title)),
    ),
    `All contributors of this release in alphabetical order: ${all.map(formatAuthor).join(', ')}`,
  );
}
