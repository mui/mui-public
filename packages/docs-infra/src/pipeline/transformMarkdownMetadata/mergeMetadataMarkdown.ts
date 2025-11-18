import { markdownToMetadata, metadataToMarkdown } from './metadataToMarkdown';
import type { PagesMetadata, PageMetadata } from './metadataToMarkdown';

/**
 * Merges new page metadata with existing markdown content, preserving the order
 * of pages from the existing markdown when available.
 *
 * Pages are matched by their `path` property (e.g., './button/page.mdx'), not by slug.
 * This allows multiple pages to have the same slug (anchor) while still being treated
 * as distinct pages.
 *
 * @param existingMarkdown - The existing markdown content (or undefined if none exists)
 * @param newMetadata - The new metadata to merge in
 * @returns The updated markdown content with merged metadata
 *
 * @example
 * ```ts
 * const existingMarkdown = `# Components
 * - [Button](#button) - [Full Docs](./button/page.mdx) - A button
 * - [Checkbox](#checkbox) - [Full Docs](./checkbox/page.mdx) - A checkbox
 * `;
 *
 * const newMetadata = {
 *   title: 'Components',
 *   pages: [
 *     { slug: 'checkbox', path: './checkbox/page.mdx', title: 'Checkbox', description: 'Updated checkbox' },
 *     { slug: 'button', path: './button/page.mdx', title: 'Button', description: 'Updated button' },
 *     { slug: 'input', path: './input/page.mdx', title: 'Input', description: 'New input' },
 *   ],
 * };
 *
 * const result = await mergeMetadataMarkdown(existingMarkdown, newMetadata);
 * // Result preserves Button, Checkbox order from existing markdown, adds Input at the end
 * ```
 */
export async function mergeMetadataMarkdown(
  existingMarkdown: string | undefined,
  newMetadata: PagesMetadata,
): Promise<string> {
  // If no existing markdown, just convert the new metadata
  if (!existingMarkdown) {
    return metadataToMarkdown(newMetadata);
  }

  // Parse the existing markdown to get the current order
  const existingMetadata = await markdownToMetadata(existingMarkdown);

  // If parsing failed, just use the new metadata
  if (!existingMetadata) {
    return metadataToMarkdown(newMetadata);
  }

  // Create a map of new pages by path for quick lookup
  const newPagesMap = new Map<string, PageMetadata>();
  for (const page of newMetadata.pages) {
    newPagesMap.set(page.path, page);
  }

  // Build the merged pages array, preserving order from existing markdown
  const mergedPages: PageMetadata[] = [];
  const addedPaths = new Set<string>();

  // First, add all pages that exist in the existing markdown, in their original order
  for (const existingPage of existingMetadata.pages) {
    const newPage = newPagesMap.get(existingPage.path);
    if (newPage) {
      // Page exists in both - merge the metadata, preferring new values
      // Only exclude descriptionMarkdown if newPage provides a new description
      const { descriptionMarkdown, ...existingPageWithoutDescriptionMarkdown } = existingPage;
      const merged = {
        ...(newPage.description ? existingPageWithoutDescriptionMarkdown : existingPage),
        ...newPage,
        // Preserve sections from existing if new doesn't have them
        sections: newPage.sections || existingPage.sections,
        // Merge openGraph, but ensure description comes from newPage if it has one
        openGraph:
          newPage.openGraph ??
          (newPage.description
            ? { ...existingPage.openGraph, description: newPage.description }
            : existingPage.openGraph),
      };
      mergedPages.push(merged);
      addedPaths.add(newPage.path);
    }
    // If page doesn't exist in new metadata, it's been removed - don't include it
  }

  // Then, add any new pages that weren't in the existing markdown
  for (const newPage of newMetadata.pages) {
    if (!addedPaths.has(newPage.path)) {
      mergedPages.push(newPage);
      addedPaths.add(newPage.path);
    }
  }

  // Create the final metadata with merged pages
  const mergedMetadata: PagesMetadata = {
    title: newMetadata.title, // Always use the new title
    pages: mergedPages,
  };

  return metadataToMarkdown(mergedMetadata);
}
