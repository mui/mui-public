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
  parseTitle,
  section,
} from '../../src/changelog/index.mjs';

/**
 * @typedef {import('../../src/changelog/index.mjs').ChangelogChange} ChangelogChange
 * @typedef {import('../../src/changelog/index.mjs').ChangelogData} ChangelogData
 */

const EXCLUDED_LABELS = [
  'dependencies',
  'docs',
  'internal',
  'release',
  'scope: code-infra',
  'scope: docs-infra',
  'scope: support-infra',
  'test',
  'website',
];
const EXCLUDED_CONTRIBUTORS = ['Copilot'];
const GENERAL = 'General changes';

/**
 * @param {string} component
 */
function getHeading(component) {
  // Hooks are identifiers.
  return /^use[A-Z]/.test(component)
    ? component
    : component.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/^Otp\b/, 'OTP');
}

/**
 * @param {ChangelogChange} change
 */
function getHeadings({ labels }) {
  if (labels.includes('scope: all components')) {
    return GENERAL;
  }
  const components = [...labelValues(labels, 'component'), ...labelValues(labels, 'hook')];
  return components.length > 0 ? components.map(getHeading) : GENERAL;
}

/**
 * @param {ChangelogChange} change
 */
function formatText({ labels, title }) {
  return joinWords(
    labels.includes('breaking change') && '🚨 **Breaking change:**',
    parseTitle(title).text,
  );
}

/**
 * @param {ChangelogChange[]} changes
 * @param {string} level - Of the headings
 * @param {(change: ChangelogChange) => string} formatChange
 */
function formatSections(changes, level, formatChange) {
  const groups = groupBy(changes, getHeadings);
  const components = [...groups.keys()].filter((heading) => heading !== GENERAL).sort();
  return [GENERAL, ...components].map((heading) =>
    section(`${level} ${heading}`, bulletList((groups.get(heading) ?? []).map(formatChange))),
  );
}

/**
 * @param {ChangelogData} data
 */
function getListedChanges(data) {
  return data.changes.filter(
    (change) => !change.labels.some((label) => EXCLUDED_LABELS.includes(label)),
  );
}

/**
 * @param {ChangelogData} data
 */
export function formatChangelog(data) {
  const changes = getListedChanges(data);
  const { all } = creditAuthors(changes, { exclude: EXCLUDED_CONTRIBUTORS });
  return joinBlocks(
    `## v${data.version}`,
    `<!-- generated comparing ${data.previous.ref}...${data.release.ref} -->`,
    `_${formatDate(data.date)}_`,
    formatSections(changes, '###', (change) => {
      const author = formatAuthor(change.author);
      return joinWords(
        formatText(change),
        `(${formatReference(change)})`,
        author && `by ${author}`,
      );
    }),
    all.length > 0 &&
      `All contributors of this release in alphabetical order: ${all.map(formatAuthor).join(', ')}`,
  );
}

/**
 * The page of a release in the docs.
 *
 * @param {ChangelogData} data
 */
export function formatDocsPage(data) {
  const date = formatDate(data.date);
  return joinBlocks(
    `# v${data.version}`,
    `<Subtitle>${date}</Subtitle>\n<Meta name="description" content="v${data.version} release notes. ${date}." />`,
    formatSections(getListedChanges(data), '##', (change) =>
      joinWords(formatText(change), `([${formatReference(change)}](${change.url}))`),
    ),
  );
}
