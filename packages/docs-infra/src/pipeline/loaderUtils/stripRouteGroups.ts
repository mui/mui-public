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
 * The name inside a route-group segment (e.g. `(overview)` -> `overview`), or `undefined` when the
 * segment is not a whole route group. Uses the same whole-segment rule as {@link isRouteGroup}, so
 * callers get one definition of the parenthesis convention instead of re-deriving it. Useful for
 * mapping a route group back to a section (e.g. resolving a section's default landing page).
 *
 * @example routeGroupName('(overview)') -> 'overview'
 * @example routeGroupName('components') -> undefined
 * @example routeGroupName('(draft)notes') -> undefined
 */
export function routeGroupName(segment: string): string | undefined {
  return isRouteGroup(segment) ? segment.slice(1, -1) : undefined;
}

/**
 * Removes Next.js route-group segments (`/(group)`) from a path or URL string, since they do not
 * appear in the public URL. Everything else is left untouched.
 *
 * Unlike {@link isRouteGroup}, this operates on the raw string, so it also strips a parenthesized
 * prefix from a larger segment (e.g. `/(draft)notes` -> `notes`). The two intentionally diverge on
 * partial-parenthesis segments; callers that must preserve whole non-group segments should use
 * {@link stripRouteGroupSegments} instead.
 *
 * @example stripRouteGroups('/react/(components)/accordion') -> '/react/accordion'
 * @example stripRouteGroups('/(public)/(content)/react') -> '/react'
 */
export function stripRouteGroups(pathOrUrl: string): string {
  return pathOrUrl.replace(/\/\([^)]+\)/g, '');
}

/**
 * Removes whole Next.js route-group segments (`(group)`) from a `/`-separated path or URL, keeping
 * every other segment intact. Unlike {@link stripRouteGroups} — a raw-string strip that also drops a
 * partial-parenthesis prefix like `(draft)notes` — this splits on `/` and filters whole segments
 * with {@link isRouteGroup}, so a folder that merely contains parentheses stays in the path. This is
 * the whole-segment rule the grouped index and search resolution share; the {@link stripRouteGroups}
 * docstring points here for callers that must preserve whole non-group segments.
 *
 * @example stripRouteGroupSegments('/components/(inputs)/checkbox') -> '/components/checkbox'
 * @example stripRouteGroupSegments('/(draft)notes/guide') -> '/(draft)notes/guide'
 */
export function stripRouteGroupSegments(pathOrUrl: string): string {
  return pathOrUrl
    .split('/')
    .filter((segment) => !isRouteGroup(segment))
    .join('/');
}
