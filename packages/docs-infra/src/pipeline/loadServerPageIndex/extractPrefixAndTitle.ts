import path from 'node:path';
import { isRouteGroup } from '../loaderUtils/stripRouteGroups';
import type { HeadingHierarchy } from '../transformMarkdownMetadata/types';
import type { SitemapSection } from '../../createSitemap/types';

/**
 * Converts a path segment to a title
 * e.g., "docs-infra" -> "Docs Infra", "components" -> "Components"
 */
export function pathSegmentToTitle(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Recursively removes titleMarkdown fields from a heading hierarchy
 */
export function stripTitleMarkdown(hierarchy: HeadingHierarchy): Record<string, SitemapSection> {
  const result: Record<string, SitemapSection> = {};
  for (const [key, value] of Object.entries(hierarchy)) {
    if (typeof value === 'object' && value !== null) {
      const { titleMarkdown, children, ...rest } = value;
      const strippedChildren = children ? stripTitleMarkdown(children) : {};
      result[key] = {
        ...rest,
        // Only include children if it has keys, otherwise set to undefined
        children: Object.keys(strippedChildren).length > 0 ? strippedChildren : undefined,
      };
    }
  }
  return result;
}

/**
 * Extracts prefix and title from an import path
 * e.g., "/path/to/app/docs-infra/components/page.mdx" -> { prefix: "/docs-infra/components/", title: "Docs Infra Components" }
 */
export function extractPrefixAndTitle(
  absolutePath: string,
  rootContext: string,
): { prefix: string; title: string } {
  // Get the relative path from the root context
  const relativePath = path.relative(rootContext, absolutePath);

  // Extract the directory path (remove filename)
  const dirPath = path.dirname(relativePath);

  // Split into segments
  const allSegments = dirPath.split(path.sep);

  // Filter out segments:
  // - Remove leading 'src' and 'app' directory markers (only if they're at the start)
  // - Remove Next.js route groups (segments in parentheses like '(public)')
  // - Remove current directory markers ('.' and empty strings)
  const segments = allSegments.filter((seg, index) => {
    // Remove 'src' only if it's the first segment
    if (seg === 'src' && index === 0) {
      return false;
    }
    // Remove 'app' only if it's the first or second segment (after 'src')
    if (seg === 'app' && (index === 0 || (index === 1 && allSegments[0] === 'src'))) {
      return false;
    }
    // Filter out Next.js route groups (e.g., '(public)', '(content)')
    if (isRouteGroup(seg)) {
      return false;
    }
    // Filter out current directory markers
    if (seg === '.' || seg === '') {
      return false;
    }
    return true;
  });

  // Generate prefix with leading and trailing slashes
  const prefix = segments.length > 0 ? `/${segments.join('/')}/` : '/';

  // Generate title from path segments
  const title = segments.map(pathSegmentToTitle).join(' ');

  return { prefix, title };
}
