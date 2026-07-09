/**
 * Resolves a search result's stored source path (e.g. `./(overview)/quick-start/page.mdx`)
 * into a browser URL (e.g. `/react/quick-start`).
 *
 * Relative source paths are joined onto the section `prefix`, stripped of their `/page.mdx`
 * suffix, and have their Next.js route-group segments (`(group)`) removed — those are
 * URL-transparent, mirroring `transformMarkdownRelativePaths`, which strips them from rendered
 * links. The route group is kept in the stored path so the index can be grouped into sections,
 * but it must never surface in a URL. An absolute stored path is already a final URL, so it is
 * returned untouched (its segments, parenthesized or not, are taken verbatim).
 */
export function resolvePageUrl(path: string, prefix: string): string {
  if (!path.startsWith('./')) {
    return path;
  }
  const relative = path.slice(2).replace(/\/page\.mdx$/, '');
  // Drop whole route-group segments (`(group)`) only — a segment that merely contains
  // parentheses (e.g. a folder literally named `(draft)notes`) is a real URL segment and is
  // kept, mirroring how the index groups it.
  const kept = relative
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
  return `${prefix}${kept.join('/')}`;
}
