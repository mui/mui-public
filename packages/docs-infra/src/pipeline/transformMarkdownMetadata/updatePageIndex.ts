import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { mergeMetadataMarkdown } from './mergeMetadataMarkdown';
import { markdownToMetadata } from './metadataToMarkdown';
import type { PageMetadata } from './metadataToMarkdown';

/**
 * Converts a kebab-case string to Title Case
 * @example kebabToTitleCase('my-component') -> 'My Component'
 * @example kebabToTitleCase('hello-world') -> 'Hello World'
 */
function kebabToTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface UpdatePageIndexOptions {
  /**
   * The path to the page file (e.g., './app/components/button/page.mdx')
   */
  pagePath: string;

  /**
   * The metadata extracted from the page
   */
  metadata: PageMetadata;

  /**
   * The title for the index file (e.g., 'Components')
   * If not provided, will be derived from the parent directory name
   * (e.g., 'app/components/page.mdx' -> 'Components')
   */
  indexTitle?: string;

  /**
   * The name of the index file to update (e.g., 'page.mdx')
   * Defaults to 'page.mdx'
   */
  indexFileName?: string;

  /**
   * Lock options for proper-lockfile
   */
  lockOptions?: lockfile.LockOptions;
}

/**
 * Updates the parent directory's index file with metadata from a page.
 *
 * This function:
 * 1. Acquires a lock on the index file
 * 2. Reads the existing index markdown (if it exists)
 * 3. Merges the new page metadata with existing metadata
 * 4. Writes the updated markdown back to the index file
 * 5. Releases the lock
 *
 * @example
 * ```ts
 * await updatePageIndex({
 *   pagePath: './app/components/button/page.mdx',
 *   metadata: {
 *     slug: 'button',
 *     path: './button/page.mdx',
 *     title: 'Button',
 *     description: 'A button component.',
 *   },
 *   indexTitle: 'Components',
 * });
 * ```
 */
export async function updatePageIndex(options: UpdatePageIndexOptions): Promise<void> {
  const { pagePath, metadata, indexFileName = 'page.mdx', lockOptions = {} } = options;

  // Resolve the parent directory and index file path
  const pageDir = dirname(pagePath);
  const parentDir = dirname(pageDir);
  const indexPath = resolve(parentDir, indexFileName);

  // Derive index title from directory name if not provided
  const indexTitle = options.indexTitle ?? kebabToTitleCase(basename(parentDir));

  // Ensure the file exists (proper-lockfile requires it)
  try {
    await readFile(indexPath, 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Create an empty file so we can lock it
      await writeFile(indexPath, '', 'utf-8');
    } else {
      throw error;
    }
  }

  let release: (() => Promise<void>) | undefined;

  try {
    // Acquire lock on the index file
    release = await lockfile.lock(indexPath, {
      retries: {
        retries: 300,
        minTimeout: 1, // Start with 1ms for fast retries
        maxTimeout: 150,
        randomize: true,
      },
      stale: 30000,
      ...lockOptions,
    });

    // Read existing index markdown (if it exists)
    let existingMarkdown: string | undefined;
    let existingPages: PageMetadata[] = [];
    try {
      const content = await readFile(indexPath, 'utf-8');
      // Only use content if it's not empty
      if (content.trim()) {
        existingMarkdown = content;
        const parsed = await markdownToMetadata(content);
        if (parsed) {
          existingPages = parsed.pages;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, that's okay
    }

    // Update or add the page in the existing pages
    const pageIndex = existingPages.findIndex((p) => p.slug === metadata.slug);
    if (pageIndex >= 0) {
      // Update existing page
      existingPages[pageIndex] = metadata;
    } else {
      // Add new page
      existingPages.push(metadata);
    }

    // Merge the metadata
    const updatedMarkdown = await mergeMetadataMarkdown(existingMarkdown, {
      title: indexTitle,
      pages: existingPages,
    });

    // Defensive check: never write empty content
    if (!updatedMarkdown || !updatedMarkdown.trim()) {
      console.error(`[updatePageIndex] ERROR: Generated empty markdown for ${indexPath}`);
      console.error(`[updatePageIndex] existingMarkdown length: ${existingMarkdown?.length ?? 0}`);
      console.error(`[updatePageIndex] existingPages count: ${existingPages.length}`);
      console.error(`[updatePageIndex] metadata:`, JSON.stringify(metadata, null, 2));
      throw new Error(`Cannot write empty content to ${indexPath}`);
    }

    // Write the updated markdown
    await writeFile(indexPath, updatedMarkdown, 'utf-8');
  } finally {
    // Always release the lock
    if (release) {
      await release();
    }
  }
}
