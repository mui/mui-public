import { matchPrefix, parseTitle } from './changelogTitle.mjs';

/**
 * @typedef {import('./types.ts').ChangelogChange} ChangelogChange
 * @typedef {import('./types.ts').ChangelogAuthor} ChangelogAuthor
 * @typedef {import('./types.ts').ChangelogCredits} ChangelogCredits
 */

const COLLATOR = new Intl.Collator('en', { numeric: true });

/**
 * Ends in a comparison by code unit, so that only equal strings are equal.
 *
 * @param {string} a
 * @param {string} b
 */
function compareText(a, b) {
  if (a === b) {
    return 0;
  }
  return COLLATOR.compare(a, b) || (a < b ? -1 : 1);
}

/**
 * @param {string} label
 */
function getKind(label) {
  return /^([^:]+):/.exec(label)?.[1];
}

/**
 * The labels of a change, and the ones its title prefixes stand for. A label wins over the prefixes
 * for its kind, the part before the colon: `scope: charts` leaves the scopes of the title out.
 *
 * @param {Pick<ChangelogChange, 'labels' | 'title'>} change
 * @param {Record<string, readonly string[]>} [prefixes] - Labels that a prefix stands for, with the
 * prefix spelled in any way
 * @returns {string[]}
 */
export function readLabels(change, prefixes = {}) {
  const kinds = new Set(change.labels.map(getKind));
  const titleLabels = parseTitle(change.title).prefixes.flatMap((prefix) => {
    const match = matchPrefix(prefix, Object.keys(prefixes));
    return match === undefined ? [] : prefixes[match];
  });
  return [
    ...new Set([
      ...change.labels,
      ...titleLabels.filter((label) => {
        const kind = getKind(label);
        return kind === undefined || !kinds.has(kind);
      }),
    ]),
  ];
}

/**
 * The values of one kind of label: `labelValues(['scope: charts', 'docs'], 'scope')` is `['charts']`.
 *
 * @param {readonly string[]} labels
 * @param {string} kind
 * @returns {string[]}
 */
export function labelValues(labels, kind) {
  return labels
    .filter((label) => getKind(label) === kind)
    .map((label) => label.slice(kind.length + 1).trim());
}

/**
 * Groups items that can be in several groups, or in none. Items keep their order.
 *
 * @template Item
 * @template {string} Group
 * @param {Iterable<Item>} items
 * @param {(item: Item) => Group | readonly Group[] | null | undefined} getGroups
 * @returns {Map<Group, Item[]>}
 */
export function groupBy(items, getGroups) {
  /** @type {Map<Group, Item[]>} */
  const groups = new Map();
  for (const item of items) {
    for (const group of new Set([getGroups(item) ?? []].flat())) {
      const members = groups.get(/** @type {Group} */ (group)) ?? [];
      members.push(item);
      groups.set(/** @type {Group} */ (group), members);
    }
  }
  return groups;
}

/**
 * Sorts by prefixes, then by the rest of the title. Changes of the same title are sorted by pull
 * request, so that the order never depends on the order they are given in.
 *
 * @template {Pick<ChangelogChange, 'title' | 'pullRequest' | 'sha'>} Change
 * @param {Iterable<Change>} changes
 * @returns {Change[]}
 */
export function sortByTitle(changes) {
  return Array.from(changes, (change) => {
    const { prefixes, text } = parseTitle(change.title);
    return { change, prefixes: prefixes.join(','), text };
  })
    .sort(
      (a, b) =>
        compareText(a.prefixes, b.prefixes) ||
        compareText(a.text, b.text) ||
        (a.change.pullRequest?.number ?? 0) - (b.change.pullRequest?.number ?? 0) ||
        compareText(a.change.sha, b.change.sha),
    )
    .map(({ change }) => change);
}

/**
 * The authors of changes, once each and in alphabetical order. Someone who joined the team during
 * the release is credited as team.
 *
 * @param {Iterable<Pick<ChangelogChange, 'author'>>} changes
 * @param {Object} [options]
 * @param {readonly string[]} [options.exclude] - Logins
 * @returns {ChangelogCredits}
 */
export function creditAuthors(changes, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map((login) => login.toLowerCase()));
  /** @type {Map<string, ChangelogAuthor>} */
  const authors = new Map();
  for (const { author } of changes) {
    const name = author?.login ?? author?.name;
    if (!author || !name || (author.login && excluded.has(author.login.toLowerCase()))) {
      continue;
    }
    // A name can equal the login of someone else.
    const key = author.login ? `@${author.login.toLowerCase()}` : name;
    if (!authors.has(key) || author.association === 'team') {
      authors.set(key, author);
    }
  }

  const all = [...authors.values()].sort((a, b) =>
    compareText(a.login ?? a.name ?? '', b.login ?? b.name ?? ''),
  );
  return {
    all,
    team: all.filter((author) => author.association === 'team'),
    community: all.filter((author) => author.association !== 'team'),
  };
}
