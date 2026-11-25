import { stripTitleMarkdown } from './extractPrefixAndTitle';
import { collapseInlineWhitespace } from '../syncPageIndex/metadataToMarkdown';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapPage } from '../../createSitemap/types';

/**
 * Converts one parsed index entry into the `SitemapPage` the sitemap exposes.
 *
 * Uses the index list label (`displayTitle`) as the title when one is set, and normalizes
 * whitespace exactly as the parser does, so a cached entry matches a fresh parse. keywords and
 * types are comma-split from a whitespace-collapsed paragraph by the parser, so each element is
 * normalized the same way.
 *
 * Copies only the fields `SitemapPage` declares. The rest, such as `embeddings` or the markdown
 * AST fields, would only add bundle size.
 *
 * Every code path that builds sitemap data from an index must use this, so they all agree.
 *
 * @param page The parsed index entry.
 * @param section The route-group section title the page is listed under, or `null`.
 */
export function toSitemapPage(page: PageMetadata, section: string | null): SitemapPage {
  return {
    title: page.displayTitle ?? page.title,
    slug: page.slug,
    path: page.path,
    description:
      page.description === undefined ? undefined : collapseInlineWhitespace(page.description),
    keywords: page.keywords?.map(collapseInlineWhitespace),
    sections: page.sections ? stripTitleMarkdown(page.sections) : undefined,
    parts: page.parts,
    exports: page.exports,
    types: page.types?.map(collapseInlineWhitespace),
    tags: page.tags,
    skipDetailSection: page.skipDetailSection,
    audience: page.audience,
    index: page.index,
    section,
    image: page.image,
  };
}
