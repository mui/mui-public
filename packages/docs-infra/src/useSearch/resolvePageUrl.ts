/**
 * Resolves a search result's stored source path (e.g. `./(overview)/quick-start/page.mdx`)
 * into a browser URL (e.g. `/react/quick-start`).
 *
 * Relative source paths are joined onto the section `prefix` and stripped of their
 * `/page.mdx` suffix. Next.js route-group segments (`(group)`) are URL-transparent, so they
 * are removed — mirroring `transformMarkdownRelativePaths`, which strips them from rendered
 * links. The route group is kept in the stored path so the index can be grouped into
 * sections, but it must never surface in a URL. Absolute paths are returned as-is apart from
 * the same route-group removal.
 */
export function resolvePageUrl(path: string, prefix: string): string {
  const url = path.startsWith('./')
    ? `${prefix}${path.slice(2).replace(/\/page\.mdx$/, '')}`
    : path;
  return url.replace(/\/\([^)]+\)/g, '');
}
