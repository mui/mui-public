/**
 * @typedef {import('./types.ts').ChangelogAuthor} ChangelogAuthor
 * @typedef {import('./types.ts').ChangelogChange} ChangelogChange
 * @typedef {import('./types.ts').ChangelogData} ChangelogData
 * @typedef {import('./types.ts').MarkdownBlock} MarkdownBlock
 * @typedef {import('./types.ts').MarkdownInline} MarkdownInline
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Joins blocks with a blank line in between. Empty ones are left out. Blank lines inside a block,
 * such as the ones of a code block, stay as they are.
 *
 * @param {...MarkdownBlock} blocks
 * @returns {string}
 */
export function joinBlocks(...blocks) {
  return blocks
    .map((block) => {
      const markdown = typeof block === 'string' ? block : joinBlocks(...(block || []));
      return markdown.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A heading and what is below it, or nothing when there is nothing below it.
 *
 * @param {string} heading
 * @param {...MarkdownBlock} blocks
 * @returns {string}
 */
export function section(heading, ...blocks) {
  const content = joinBlocks(...blocks);
  return content && joinBlocks(heading, content);
}

/**
 * @param {Iterable<MarkdownInline>} items
 * @returns {string}
 */
export function bulletList(items) {
  return Array.from(items)
    .flatMap((item) => (item ? [`- ${item.trim().replace(/\n(?=.)/g, '\n  ')}`] : []))
    .join('\n');
}

/**
 * Joins the parts of a line with a space. Empty ones are left out.
 *
 * @param {...MarkdownInline} parts
 * @returns {string}
 */
export function joinWords(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * `#123`, or the short SHA of a change without a pull request.
 *
 * @param {Pick<ChangelogChange, 'pullRequest' | 'sha'>} change
 * @returns {string}
 */
export function formatReference({ pullRequest, sha }) {
  return pullRequest ? `#${pullRequest.number}` : sha.slice(0, 7);
}

/**
 * `@login`, or the name of an author without a GitHub account. Empty when neither is known.
 *
 * @param {Pick<ChangelogAuthor, 'login' | 'name'> | null} author
 * @returns {string}
 */
export function formatAuthor(author) {
  if (author?.login) {
    return `@${author.login}`;
  }
  return (author?.name ?? '').replace(/[\\`*_[\]<>]/g, '\\$&');
}

/**
 * `Jan 2, 2026`, in UTC like the date of a release.
 *
 * @param {string} date - ISO 8601
 * @returns {string}
 */
export function formatDate(date) {
  return DATE_FORMAT.format(new Date(date));
}

/**
 * What is below the heading of a release: a comment with the range it was generated from, and its
 * date.
 *
 * @param {Pick<ChangelogData, 'previous' | 'release' | 'date'>} data
 * @returns {string}
 */
export function formatSubHeader({ previous, release, date }) {
  return joinBlocks(
    `<!-- generated comparing ${previous.ref}...${release.ref} -->`,
    `_${formatDate(date)}_`,
  );
}
