/**
 * Whether a single path segment is a Next.js route group: a directory name wrapped in
 * parentheses (e.g. `(overview)`). Route groups organize files without appearing in the public
 * URL. This is the one shared definition used by page grouping, parent-index resolution, and
 * path-to-URL resolution.
 *
 * Because it tests a whole segment, a segment that merely contains parentheses (e.g.
 * `(draft)notes`) is not a route group and is kept. This is the deliberate difference from
 * {@link stripRouteGroups}.
 *
 * @example isRouteGroup('(overview)') -> true
 * @example isRouteGroup('components') -> false
 * @example isRouteGroup('(draft)notes') -> false
 */
export function isRouteGroup(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')');
}

/**
 * Removes Next.js route-group segments (`/(group)`) from a path or URL string, since they do not
 * appear in the public URL. Everything else is left untouched.
 *
 * Unlike {@link isRouteGroup}, this operates on the raw string, so it also strips a parenthesized
 * prefix from a larger segment (e.g. `/(draft)notes` -> `notes`). The two intentionally diverge on
 * partial-parenthesis segments; callers that must preserve whole non-group segments should filter
 * with {@link isRouteGroup} instead.
 *
 * @example stripRouteGroups('/react/(components)/accordion') -> '/react/accordion'
 * @example stripRouteGroups('/(public)/(content)/react') -> '/react'
 */
export function stripRouteGroups(pathOrUrl: string): string {
  return pathOrUrl.replace(/\/\([^)]+\)/g, '');
}
