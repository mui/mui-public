import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve, relative, join } from 'node:path';
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
   * OR the path to the index file itself when using metadataList
   */
  pagePath: string;

  /**
   * The metadata extracted from the page
   * Either provide this for a single update, or metadataList for batch updates
   */
  metadata?: PageMetadata;

  /**
   * Array of metadata for batch updates
   * When provided, all metadata will be merged in a single file lock/write operation
   */
  metadataList?: PageMetadata[];

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

  /**
   * Only update existing indexes, don't create new ones
   * When true, will skip updating if the index file doesn't already exist
   * @default false
   */
  onlyUpdateIndexes?: boolean;

  /**
   * Directory to write marker files when indexes are updated.
   * Path is relative to baseDir.
   * Set to false to disable marker file creation.
   * A marker file will be created at: `${markerDir}/${relativePath}/page.mdx`
   * @default false
   */
  markerDir?: string | false;

  /**
   * Throw an error if the index is out of date or missing.
   * Useful for CI environments to ensure indexes are committed.
   * @default false
   */
  errorIfOutOfDate?: boolean;
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
    metadataList,
    indexFileName = 'page.mdx',
    lockOptions = {},
    baseDir,
    updateParents = false,
    include,
    exclude,
    onlyUpdateIndexes = false,
    markerDir = false,
    errorIfOutOfDate = false,
  } = options;

  // Validate that either metadata or metadataList is provided
  if (!metadata && (!metadataList || metadataList.length === 0)) {
    throw new Error('Either metadata or metadataList must be provided');
  }

  // Determine if we're doing a batch update
  const isBatchUpdate = !!metadataList;
  const metadataArray = isBatchUpdate ? metadataList : [metadata!];

  // Resolve the index file path
  // For batch updates, pagePath is the index file itself
  // For single updates, pagePath is a child page and we need the parent's index
  const indexPath = isBatchUpdate
    ? resolve(pagePath)
    : resolve(getParentDir(dirname(pagePath), true), indexFileName);

  const parentDir = dirname(indexPath);

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
  let fileExists = true;
  try {
    existingContent = await readFile(indexPath, 'utf-8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist
    fileExists = false;

    // If onlyUpdateIndexes is true and file doesn't exist, skip this update
    if (onlyUpdateIndexes) {
      return;
    }

    // If errorIfOutOfDate is true, throw an error for missing index
    if (errorIfOutOfDate) {
      const relativeIndexPath = baseDir ? relative(resolve(baseDir), indexPath) : indexPath;
      throw new Error(
        `Index file is missing: ${relativeIndexPath}\n` +
          `Please run next build locally and commit the updated index files.\n` +
          `Don't forget to add it to the \`app/sitemap/index.ts\` to list it publicly.`,
      );
    }
  }

  // Step 1.5: Verify the file has the autogeneration marker if it exists
  if (fileExists && existingContent) {
    const hasMarker = existingContent.includes("[//]: # 'This file is autogenerated");
    if (!hasMarker) {
      // File exists but doesn't have the autogeneration marker - skip updating it
      return;
    }
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

  // Step 3: Check if any of our metadata items need updating
  let needsUpdate = false;
  for (const metaItem of metadataArray) {
    const existingPageIndex = existingPages.findIndex((p) => p.slug === metaItem.slug);
    if (existingPageIndex >= 0) {
      const existingPage = existingPages[existingPageIndex];
      // Compare metadata - if different, we need to update
      const existingPageJson = JSON.stringify(existingPage);
      const newPageJson = JSON.stringify(metaItem);
      if (existingPageJson !== newPageJson) {
        needsUpdate = true;
        break;
      }
    } else {
      // Page doesn't exist, we need to add it
      needsUpdate = true;
      break;
    }
  }

  if (!needsUpdate) {
    // All pages are already up-to-date, no need to acquire lock or write
    return;
  }

  // If errorIfOutOfDate is true, throw an error instead of updating
  if (errorIfOutOfDate) {
    const relativeIndexPath = baseDir ? relative(resolve(baseDir), indexPath) : indexPath;
    throw new Error(
      `Index file is out of date: ${relativeIndexPath}\n` +
        `Please run the validation command (or next build) locally and commit the updated index files.`,
    );
  }

  // Step 4: Ensure the file exists before locking (proper-lockfile requires an existing file)
  if (!fileExists) {
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

    // For batch updates, merge the metadata items with existing pages
    // Build a map keyed by path (not slug) to match mergeMetadataMarkdown's logic
    const updatedPagesMap = new Map<string, PageMetadata>();

    // First, add all current pages
    for (const page of currentPages) {
      updatedPagesMap.set(page.path, page);
    }

    // Then update/add the new metadata items
    for (const metaItem of metadataArray) {
      updatedPagesMap.set(metaItem.path, metaItem);
    }

    // Convert back to array - this is the COMPLETE list of pages that should exist
    const allPages = Array.from(updatedPagesMap.values());

    // Store for parent update
    mergedPages = allPages;

    // Re-merge with the latest content, passing the COMPLETE list of pages
    // mergeMetadataMarkdown will preserve the order from currentMarkdown
    const finalMarkdown = await mergeMetadataMarkdown(currentMarkdown, {
      title: indexTitle,
      pages: allPages,
    });

    // Defensive check
    if (!finalMarkdown || !finalMarkdown.trim()) {
      throw new Error(`Cannot write empty content to ${indexPath}`);
    }

    // Step 7: Write only if the final content differs from what's currently on disk
    if (currentContent !== finalMarkdown) {
      await writeFile(indexPath, finalMarkdown, 'utf-8');

      // Create a marker file unless explicitly disabled
      if (markerDir) {
        const relativeIndexPath = baseDir ? relative(resolve(baseDir), indexPath) : indexPath;
        // Resolve markerDir relative to baseDir (if baseDir is provided)
        const markerDirResolved = baseDir ? resolve(baseDir, markerDir) : markerDir;
        const markerPath = join(markerDirResolved, relativeIndexPath);
        const markerDirPath = dirname(markerPath);

        // Ensure the marker directory exists
        await mkdir(markerDirPath, { recursive: true });

        // Create an empty marker file
        await writeFile(markerPath, '', 'utf-8');
      }
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
        onlyUpdateIndexes,
        markerDir,
        errorIfOutOfDate,
      });
    }
  }
}
