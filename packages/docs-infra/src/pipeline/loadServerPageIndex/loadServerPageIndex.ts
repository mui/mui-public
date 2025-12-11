import fs from 'node:fs/promises';
import path from 'node:path';
import { markdownToMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { HeadingHierarchy } from '../transformMarkdownMetadata/types';
import type { SitemapSection, SitemapSectionData } from '../../createSitemap/types';

/**
 * Options for creating a loadServerPageIndex function
 */
export interface CreateLoadServerPageIndexOptions {
  /**
   * The root context directory for resolving relative paths.
   * Defaults to process.cwd().
   */
  rootContext?: string;
}

/**
 * Function type for loading page index data from a markdown file
 */
export type LoadServerPageIndex = (filePath: string) => Promise<SitemapSectionData | null>;

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
    if (seg.startsWith('(') && seg.endsWith(')')) {
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

/**
 * Default loadServerPageIndex function that loads page index data from a markdown file.
 * This function uses process.cwd() as the root context for resolving relative paths.
 */
export const loadServerPageIndex: LoadServerPageIndex = createLoadServerPageIndex();

/**
 * Creates a loadServerPageIndex function with custom options.
 *
 * This factory function creates a LoadServerPageIndex implementation that:
 * 1. Reads the markdown file from the provided file path
 * 2. Parses the markdown to extract metadata using markdownToMetadata
 * 3. Enriches the metadata with prefix and title derived from the file path
 * 4. Returns a SitemapSectionData object with page data
 *
 * @param options - Configuration options for the loader
 * @returns LoadServerPageIndex function that takes a file path and returns Promise<SitemapSectionData | null>
 */
export function createLoadServerPageIndex(
  options: CreateLoadServerPageIndexOptions = {},
): LoadServerPageIndex {
  const rootContext = options.rootContext ?? process.cwd();

  return async function loadPageIndex(filePath: string): Promise<SitemapSectionData | null> {
    // Resolve the absolute path to the markdown file
    const absolutePath = filePath.startsWith('file://') ? filePath.slice(7) : filePath;

    // Extract prefix and title from the import path
    const { prefix, title: generatedTitle } = extractPrefixAndTitle(absolutePath, rootContext);

    // Read the markdown file
    const markdownContent = await fs.readFile(absolutePath, 'utf-8');

    // Parse the markdown to extract metadata
    const metadata = await markdownToMetadata(markdownContent);

    if (!metadata) {
      return null;
    }

    // Add prefix and override title with the generated one from the path
    // Strip descriptionMarkdown and titleMarkdown to reduce bundle size
    const enrichedMetadata: SitemapSectionData = {
      ...metadata,
      prefix,
      // Use the generated title from the path (override markdown's H1)
      title: generatedTitle,
      // Strip markdown AST fields from each page to reduce size
      pages: metadata.pages.map((page) => {
        const { descriptionMarkdown, sections, ...pageWithoutMarkdown } = page;
        return {
          ...pageWithoutMarkdown,
          // Strip titleMarkdown from sections hierarchy
          sections: sections ? stripTitleMarkdown(sections) : undefined,
        };
      }),
    };

    return enrichedMetadata;
  };
}
