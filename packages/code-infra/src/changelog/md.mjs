/**
 * Markdown primitives for changelog views. A view is `(groomed) => string`.
 */

/**
 * @typedef {import('./types.ts').ReleaseEntry} ReleaseEntry
 * @typedef {string | number | false | null | undefined | readonly Block[]} Block
 */

const SHORT_SHA_LENGTH = 7;

const MONTHS = [
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

/** @param {Block} value @returns {string[]} */
function blocks(value) {
  if (Array.isArray(value)) {
    return value.flatMap(blocks);
  }

  if (value === null || value === undefined || value === false || value === '') {
    return [];
  }

  return [String(value)];
}

/**
 * Join blocks with one blank line and end with a newline. Arrays become consecutive blocks;
 * `null`, `undefined`, `false` and empty strings disappear with their spacing. Interpolations are
 * inserted verbatim: entry titles carry author markdown, so escape with `escape` where needed.
 *
 * @param {TemplateStringsArray} strings
 * @param {...Block} values
 * @returns {string}
 */
export function md(strings, ...values) {
  const text = strings.reduce(
    (result, part, index) =>
      result + part + (index < values.length ? blocks(values[index]).join('\n\n') : ''),
    '',
  );

  const body = text
    .split(/\n[ \t]*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '')
    .join('\n\n');

  return body ? `${body}\n` : '';
}

/**
 * Escape characters that markdown would interpret.
 * @param {string} text
 */
export function escape(text) {
  return text.replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&');
}

/**
 * @param {number} level
 * @param {string} text
 */
export function Heading(level, text) {
  return `${'#'.repeat(level)} ${text}`.trimEnd();
}

/**
 * Heading for a package section, e.g. `` ### `@mui/material@9.0.0` ``.
 * @param {number} level
 * @param {{ name: string; version: string | null }} pkg
 * @param {string} [suffix] For example a plan badge.
 */
export function PackageHeading(level, pkg, suffix = '') {
  return Heading(level, `\`${pkg.name}@${pkg.version ?? ''}\` ${suffix}`);
}

/**
 * A bulleted list, or nothing when empty.
 * @template {ReleaseEntry} T
 * @param {readonly T[]} entries
 * @param {(entry: T) => string} [format]
 */
export function EntryList(entries, format = Entry) {
  return entries.map((entry) => `- ${format(entry)}`).join('\n');
}

/**
 * `[prefix] title (#123) @author`; direct commits link their short SHA and fall back to the git name.
 * @param {ReleaseEntry} entry
 * @param {readonly string[]} [prefixes]
 */
export function Entry(entry, prefixes = entry.prefixes) {
  const title = `${prefixes.map((prefix) => `[${prefix}]`).join('')} ${entry.title}`.trim();

  const link =
    entry.pr === null
      ? `[${entry.sha.slice(0, SHORT_SHA_LENGTH)}](${entry.url})`
      : `(#${entry.pr})`;

  return `${title} ${link} ${Author(entry)}`;
}

/** @param {ReleaseEntry} entry */
export function Author(entry) {
  if (entry.author?.login) {
    return `@${entry.author.login}`;
  }

  return entry.author?.name ?? '@unknown';
}

/**
 * `@a, @b`
 * @param {readonly string[]} logins
 */
export function mentions(logins) {
  return logins.map((login) => `@${login}`).join(', ');
}

/**
 * A contributors paragraph, or nothing when no one is listed.
 * @param {readonly string[]} logins
 * @param {(list: string, count: number) => string} sentence
 */
export function Contributors(logins, sentence) {
  return logins.length > 0 ? sentence(mentions(logins), logins.length) : '';
}

/**
 * Format with `MMMM`, `MMM`, `DD` and `YYYY`, in local time.
 * @param {Date | string} value
 * @param {string} [format]
 */
export function formatDate(value, format = '_MMM DD, YYYY_') {
  const date = new Date(value);
  const month = MONTHS[date.getMonth()];

  return format
    .replace('MMMM', month)
    .replace('MMM', month.slice(0, 3))
    .replace('DD', String(date.getDate()).padStart(2, '0'))
    .replace('YYYY', String(date.getFullYear()));
}
