import { stripTitleMarkdown } from './extractPrefixAndTitle';
import { collapseInlineWhitespace } from '../syncPageIndex/metadataToMarkdown';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapPage } from '../../createSitemap/types';

/**
 * Converts one parsed index entry into the `SitemapPage` the sitemap exposes.
 *
 * Uses the index list label (`displayTitle`) as the title when one is set, strips the markdown AST
 * fields (`descriptionMarkdown`, section `titleMarkdown`) to reduce bundle size, and normalizes
 * whitespace exactly as the parser does, so a cached entry matches a fresh parse. keywords and
 * types are comma-split from a whitespace-collapsed paragraph by the parser, so each element is
 * normalized the same way.
 *
 * Every code path that builds sitemap data from an index must use this, so they all agree.
 *
 * @param page The parsed index entry.
 * @param section The route-group section title the page is listed under, or `null`.
 */
export function toSitemapPage(page: PageMetadata, section: string | null): SitemapPage {
  const { descriptionMarkdown, sections, sectionGroup, displayTitle, ...rest } = page;
  return {
    ...rest,
    title: displayTitle ?? page.title,
    description:
      page.description === undefined ? undefined : collapseInlineWhitespace(page.description),
    keywords: page.keywords?.map(collapseInlineWhitespace),
    types: page.types?.map(collapseInlineWhitespace),
    sections: sections ? stripTitleMarkdown(sections) : undefined,
    section,
  };
}
