import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, relative } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { mergeMetadataMarkdown } from './mergeMetadataMarkdown';
import { markdownToMetadata } from './metadataToMarkdown';
import type { PageMetadata } from './metadataToMarkdown';
import type { HeadingHierarchy } from './transformMarkdownMetadata';

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

/**
 * Checks if a directory name is a Next.js route group (wrapped in parentheses)
 * @example isRouteGroup('(public)') -> true
 * @example isRouteGroup('components') -> false
 */
function isRouteGroup(dirName: string): boolean {
  return dirName.startsWith('(') && dirName.endsWith(')');
}

/**
 * Gets the parent directory, skipping over Next.js route groups
 * @example getParentDir('/app/(public)/(content)/react') -> '/app/(public)/(content)'
 * When recursing, skips route groups: '/app/(public)/(content)' -> '/app'
 */
function getParentDir(path: string, skipRouteGroups: boolean = false): string {
  let parent = dirname(path);

  // If we should skip route groups, keep going up until we find a non-route-group directory
  if (skipRouteGroups) {
    while (parent !== dirname(parent) && isRouteGroup(basename(parent))) {
      parent = dirname(parent);
    }
  }

  return parent;
}

/**
 * Checks if a path should be included based on include/exclude patterns
 * @param path The path to check (relative to baseDir)
 * @param include Include patterns - if provided, path must match at least one
 * @param exclude Exclude patterns - if path matches any, it's excluded
 * @returns true if the path should be included, false otherwise
 */
function shouldIncludePath(path: string, include?: string[], exclude?: string[]): boolean {
  // Normalize path separators to forward slashes
  const normalizedPath = path.replace(/\\/g, '/');

  // Check exclude patterns first
  if (exclude && exclude.length > 0) {
    for (const pattern of exclude) {
      const normalizedPattern = pattern.replace(/\\/g, '/');
      if (normalizedPath.startsWith(normalizedPattern)) {
        return false;
      }
    }
  }

  // If no include patterns, include by default (unless excluded above)
  if (!include || include.length === 0) {
    return true;
  }

  // Check if path matches any include pattern
  for (const pattern of include) {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    if (normalizedPath.startsWith(normalizedPattern)) {
      return true;
    }
  }

  // Path doesn't match any include pattern
  return false;
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

  /**
   * The base directory to stop recursion at (e.g., './app')
   * If not provided, will continue until reaching the root directory
   */
  baseDir?: string;

  /**
   * Whether to update parent indexes recursively
   * @default false
   */
  updateParents?: boolean;

  /**
   * Path patterns to include when creating/updating indexes
   * Only indexes within these paths will be created or modified
   * Patterns are matched against the directory path relative to baseDir
   */
  include?: string[];

  /**
   * Path patterns to exclude when creating/updating indexes
   * Indexes matching these patterns will not be created or modified
   * Patterns are matched against the directory path relative to baseDir
   */
  exclude?: string[];
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
 * 6. Optionally updates parent indexes recursively
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
  const {
    pagePath,
    metadata,
    indexFileName = 'page.mdx',
    lockOptions = {},
    baseDir,
    updateParents = false,
    include,
    exclude,
  } = options;

  // Resolve the parent directory and index file path
  // Skip over Next.js route groups (directories wrapped in parentheses)
  const pageDir = dirname(pagePath);
  const parentDir = getParentDir(pageDir, true);
  const indexPath = resolve(parentDir, indexFileName);

  // Check if this index path should be processed based on include/exclude filters
  if (baseDir) {
    const relativePath = relative(resolve(baseDir), resolve(parentDir));
    if (!shouldIncludePath(relativePath, include, exclude)) {
      // This index is outside the configured paths - skip it
      return;
    }
  }

  // Check if we've reached the base directory
  const shouldStop = baseDir && resolve(parentDir) === resolve(baseDir);

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

  // After releasing the lock, update the parent index if needed
  if (updateParents && !shouldStop) {
    // Get the grandparent directory, skipping over Next.js route groups
    const grandParentDir = getParentDir(parentDir, true);

    // Only continue if we're not at the filesystem root
    if (grandParentDir !== parentDir) {
      // Read the current index file we just updated to extract its metadata (including sections)
      const indexContent = await readFile(indexPath, 'utf-8');
      const parsedIndex = await markdownToMetadata(indexContent);

      // Calculate the relative path from grandparent to this index, preserving route groups
      const relativePathFromGrandparent = relative(grandParentDir, parentDir);

      // Extract metadata for the current index to add to its parent
      const indexMetadata: PageMetadata = {
        slug: basename(parentDir),
        path: `./${relativePathFromGrandparent}/${indexFileName}`,
        title: indexTitle,
        description: 'No description available',
      };

      // If we successfully parsed the index, extract sections from it
      // The sections are the child pages listed in the index (as H2 headings)
      if (parsedIndex && parsedIndex.pages && parsedIndex.pages.length > 0) {
        // Convert child pages to sections format (top-level only, no nested children)
        const sections: HeadingHierarchy = {};
        for (const childPage of parsedIndex.pages) {
          sections[childPage.slug] = {
            title: childPage.title || childPage.slug,
            titleMarkdown: childPage.title
              ? [{ type: 'text', value: childPage.title }]
              : [{ type: 'text', value: childPage.slug }],
            children: {}, // Don't include nested children in the parent index
          };
        }
        indexMetadata.sections = sections;
        indexMetadata.title = parsedIndex.title || indexTitle;
      }

      // Recursively update the parent index (will create it if it doesn't exist)
      await updatePageIndex({
        pagePath: indexPath,
        metadata: indexMetadata,
        indexFileName,
        lockOptions,
        baseDir,
        updateParents: true,
        include,
        exclude,
      });
    }
  }
}
