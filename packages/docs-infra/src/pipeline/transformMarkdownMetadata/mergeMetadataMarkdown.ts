import { markdownToMetadata, metadataToMarkdown } from './metadataToMarkdown';
import type { PagesMetadata, PageMetadata } from './metadataToMarkdown';

/**
 * Merges new page metadata with existing markdown content, preserving the order
 * of pages from the existing markdown when available.
 *
 * @param existingMarkdown - The existing markdown content (or undefined if none exists)
 * @param newMetadata - The new metadata to merge in
 * @returns The updated markdown content with merged metadata
 *
 * @example
 * ```ts
 * const existingMarkdown = `# Components
 * - [Button](./button/page.mdx) - A button
 * - [Checkbox](./checkbox/page.mdx) - A checkbox
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

  // Create a map of new pages by slug for quick lookup
  const newPagesMap = new Map<string, PageMetadata>();
  for (const page of newMetadata.pages) {
    newPagesMap.set(page.slug, page);
  }

  // Build the merged pages array, preserving order from existing markdown
  const mergedPages: PageMetadata[] = [];
  const addedSlugs = new Set<string>();

  // First, add all pages that exist in the existing markdown, in their original order
  for (const existingPage of existingMetadata.pages) {
    const newPage = newPagesMap.get(existingPage.slug);
    if (newPage) {
      // Page exists in both - use the new metadata
      mergedPages.push(newPage);
      addedSlugs.add(newPage.slug);
    }
    // If page doesn't exist in new metadata, it's been removed - don't include it
  }

  // Then, add any new pages that weren't in the existing markdown
  for (const newPage of newMetadata.pages) {
    if (!addedSlugs.has(newPage.slug)) {
      mergedPages.push(newPage);
      addedSlugs.add(newPage.slug);
    }
  }

  // Create the final metadata with merged pages
  const mergedMetadata: PagesMetadata = {
    title: newMetadata.title, // Always use the new title
    pages: mergedPages,
  };

  return metadataToMarkdown(mergedMetadata);
}
