/**
 * @typedef {import('./types.ts').ChangelogTitle} ChangelogTitle
 */

const PREFIX = /^\[([^[\]]+)\]\s*/;

/**
 * Splits the leading `[prefixes]` off a title.
 *
 * @param {string} title
 * @returns {ChangelogTitle}
 */
export function parseTitle(title) {
  const prefixes = [];
  let text = title.trim();
  for (let match = PREFIX.exec(text); match; match = PREFIX.exec(text)) {
    prefixes.push(match[1].trim());
    text = text.slice(match[0].length);
  }
  return { prefixes, text };
}

/**
 * @param {string} prefix
 */
function normalizePrefix(prefix) {
  return prefix.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * The candidate that a prefix is a spelling of: case, spaces, hyphens and underscores don't matter.
 *
 * @template {string} Candidate
 * @param {string} prefix
 * @param {Iterable<Candidate>} candidates
 * @returns {Candidate | undefined}
 */
export function matchPrefix(prefix, candidates) {
  const normalized = normalizePrefix(prefix);
  return Array.from(candidates).find((candidate) => normalizePrefix(candidate) === normalized);
}

/**
 * Rewrites the prefixes of a title. Duplicates and prefixes that become empty are left out.
 *
 * @param {string} title
 * @param {(prefix: string) => string} rewrite
 * @returns {string}
 */
export function mapPrefixes(title, rewrite) {
  const { prefixes, text } = parseTitle(title);
  const rewritten = new Set(prefixes.map((prefix) => rewrite(prefix)).filter(Boolean));
  return [Array.from(rewritten, (prefix) => `[${prefix}]`).join(''), text]
    .filter(Boolean)
    .join(' ');
}
