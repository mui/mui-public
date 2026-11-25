import { extractPrefixAndTitle } from './extractPrefixAndTitle';
import { toSitemapPage } from './toSitemapPage';
import {
  collapseInlineWhitespace,
  createPageSectionResolver,
} from '../syncPageIndex/metadataToMarkdown';
import type { PagesMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapSectionData } from '../../createSitemap/types';

/**
 * Converts parsed page-index metadata into the `SitemapSectionData` read-model.
 *
 * Derives `prefix` and `title` from the file path (overriding the markdown H1), normalizes the
 * index's description, and converts each page with `toSitemapPage`, so the cache (built from
 * in-memory metadata) matches a fresh parse of the written markdown.
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

  // Resolve each page's section title from its route group (grouped indexes only).
  const resolveSection = createPageSectionResolver(metadata.sections);

  return {
    ...metadata,
    prefix,
    title,
    // Always present so consumers never branch on absence: an empty array for a flat index.
    sections: metadata.sections ?? [],
    // Normalize the index's own (leaked) description like the parser. Spread instead of an explicit
    // key because SitemapSectionData does not declare `description`.
    ...(metadata.description !== undefined
      ? { description: collapseInlineWhitespace(metadata.description) }
      : {}),
    // Resolve the route-group section title for grouped indexes (search faceting), honoring the
    // header a human filed an otherwise-ungrouped page under.
    pages: metadata.pages.map((page) =>
      toSitemapPage(page, resolveSection(page.path, page.sectionGroup) ?? null),
    ),
  };
}
