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

  // Step 1: Read the file without acquiring a lock to check if we need to make changes
  let existingContent = '';
  try {
    existingContent = await readFile(indexPath, 'utf-8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist - we'll need to create it
  }

  // Step 2: Parse existing content and check if our specific page needs updating
  const existingMarkdown = existingContent.trim() ? existingContent : undefined;
  let existingPages: PageMetadata[] = [];
  if (existingMarkdown) {
    const parsed = await markdownToMetadata(existingMarkdown);
    if (parsed) {
      existingPages = parsed.pages;
    }
  }

  // Step 3: Check if our specific page already exists with the same metadata
  const existingPageIndex = existingPages.findIndex((p) => p.slug === metadata.slug);
  if (existingPageIndex >= 0) {
    const existingPage = existingPages[existingPageIndex];
    // Compare our page's metadata - if identical, we can skip the update
    const existingPageJson = JSON.stringify(existingPage);
    const newPageJson = JSON.stringify(metadata);
    if (existingPageJson === newPageJson) {
      // Our page is already up-to-date, no need to acquire lock or write
      return;
    }
  }

  // Our page is missing or outdated, we need to update the index
  // Update or add the page in the existing pages
  if (existingPageIndex >= 0) {
    existingPages[existingPageIndex] = metadata;
  } else {
    existingPages.push(metadata);
  }

  // Step 4: Ensure the file exists before locking (proper-lockfile requires an existing file)
  if (!existingContent) {
    await writeFile(indexPath, '', 'utf-8');
  }

  let release: (() => Promise<void>) | undefined;
  let mergedPages: PageMetadata[] = []; // Store merged pages for parent update

  try {
    // Step 5: Acquire lock on the index file
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

    // Step 6: Re-read and re-merge to catch any concurrent updates from other processes
    // This ensures we don't lose updates from other pages being processed in parallel
    let currentContent = '';
    try {
      currentContent = await readFile(indexPath, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File was deleted while waiting - that's okay, we'll create it
    }

    const currentMarkdown = currentContent.trim() ? currentContent : undefined;
    let currentPages: PageMetadata[] = [];
    if (currentMarkdown) {
      const parsed = await markdownToMetadata(currentMarkdown);
      if (parsed) {
        currentPages = parsed.pages;
      }
    }

    // Update or add our page in the current pages (catching concurrent updates)
    const currentPageIndex = currentPages.findIndex((p) => p.slug === metadata.slug);
    if (currentPageIndex >= 0) {
      currentPages[currentPageIndex] = metadata;
    } else {
      currentPages.push(metadata);
    }

    // Store for parent update
    mergedPages = currentPages;

    // Re-merge with the latest content
    const finalMarkdown = await mergeMetadataMarkdown(currentMarkdown, {
      title: indexTitle,
      pages: currentPages,
    });

    // Defensive check
    if (!finalMarkdown || !finalMarkdown.trim()) {
      throw new Error(`Cannot write empty content to ${indexPath}`);
    }

    // Step 7: Write only if the final content differs from what's currently on disk
    if (currentContent !== finalMarkdown) {
      await writeFile(indexPath, finalMarkdown, 'utf-8');
    }
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
      // CRITICAL: Use the merged pages from Step 6, not a re-read of the file
      // Re-reading could get a stale version if other processes are still writing
      // mergedPages already contains ALL pages after the merge in Step 6

      // Calculate the relative path from grandparent to this index, preserving route groups
      const relativePathFromGrandparent = relative(grandParentDir, parentDir);

      // Extract metadata for the current index to add to its parent
      const indexMetadata: PageMetadata = {
        slug: basename(parentDir),
        path: `./${relativePathFromGrandparent}/${indexFileName}`,
        title: indexTitle,
        description: 'No description available',
      };

      // Convert child pages to sections format (no subsections, just page names)
      // Use mergedPages which contains the complete merged state
      if (mergedPages.length > 0) {
        const sections: HeadingHierarchy = {};
        for (const childPage of mergedPages) {
          sections[childPage.slug] = {
            title: childPage.title || childPage.slug,
            titleMarkdown: childPage.title
              ? [{ type: 'text', value: childPage.title }]
              : [{ type: 'text', value: childPage.slug }],
            children: {}, // Don't include any subsections in parent index
          };
        }
        indexMetadata.sections = sections;
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
