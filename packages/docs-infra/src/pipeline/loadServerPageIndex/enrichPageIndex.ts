import { extractPrefixAndTitle, stripTitleMarkdown } from './extractPrefixAndTitle';
import type { PagesMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SitemapSectionData } from '../../createSitemap/types';

/**
 * Converts parsed page-index metadata into the `SitemapSectionData` read-model.
 *
 * Derives `prefix` and `title` from the file path (overriding the markdown H1) and
 * strips the markdown AST fields (`descriptionMarkdown`, section `titleMarkdown`)
 * to reduce bundle size.
 *
 * Shared by `loadServerPageIndex` (read path) and `syncPageIndex` (cache pre-population
 * on write) so both produce byte-identical output for the same input.
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
    // Strip markdown AST fields from each page to reduce size.
    pages: metadata.pages.map((page) => {
      const { descriptionMarkdown, sections, ...pageWithoutMarkdown } = page;
      return {
        ...pageWithoutMarkdown,
        // Strip titleMarkdown from the sections hierarchy.
        sections: sections ? stripTitleMarkdown(sections) : undefined,
      };
    }),
  };
}
