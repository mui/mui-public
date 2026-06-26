import { extractPrefixAndTitle, stripTitleMarkdown } from './extractPrefixAndTitle';
import { collapseInlineWhitespace } from '../syncPageIndex/metadataToMarkdown';
import type { PagesMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapSectionData } from '../../createSitemap/types';

/**
 * Converts parsed page-index metadata into the `SitemapSectionData` read-model.
 *
 * Derives `prefix` and `title` from the file path (overriding the markdown H1), strips the
 * markdown AST fields (`descriptionMarkdown`, section `titleMarkdown`) to reduce bundle size, and
 * normalizes description whitespace exactly as the parser does so the cache (built from in-memory
 * metadata) matches a fresh parse of the written markdown.
 *
 * Shared by `loadServerPageIndex` (read path) and `syncPageIndex` (cache pre-population on write).
 * Normalization is idempotent, so re-applying it on the read path (where descriptions are already
 * normalized) is a no-op.
 */
export function enrichPageIndex(
  metadata: PagesMetadata,
  absolutePath: string,
  rootContext: string,
): SitemapSectionData {
  // Override the markdown's H1 with the title generated from the path.
  const { prefix, title } = extractPrefixAndTitle(absolutePath, rootContext);

  return {
    ...metadata,
    prefix,
    title,
    // Normalize the index's own (leaked) description like the parser. Spread instead of an explicit
    // key because SitemapSectionData does not declare `description`.
    ...(metadata.description !== undefined
      ? { description: collapseInlineWhitespace(metadata.description) }
      : {}),
    // Strip markdown AST fields and normalize each page's description. keywords and types are
    // comma-split from a whitespace-collapsed paragraph by the parser, so normalize each element
    // the same way (collapse-then-split equals split-then-per-element-collapse, since the comma
    // delimiter can't appear inside a value) — otherwise a cache hit diverges from a fresh parse.
    pages: metadata.pages.map((page) => {
      const { descriptionMarkdown, sections, ...pageWithoutMarkdown } = page;
      return {
        ...pageWithoutMarkdown,
        description:
          page.description === undefined ? undefined : collapseInlineWhitespace(page.description),
        keywords: page.keywords?.map(collapseInlineWhitespace),
        types: page.types?.map(collapseInlineWhitespace),
        // Strip titleMarkdown from the sections hierarchy.
        sections: sections ? stripTitleMarkdown(sections) : undefined,
      };
    }),
  };
}
