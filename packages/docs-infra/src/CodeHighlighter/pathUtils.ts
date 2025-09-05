/**
 * Shared path utilities for CodeHighlighter components
 *
 * Back navigation counting functions:
 * - resolveRelativePath().backSteps: Net back navigation after path resolution (recommended for most cases)
 * - countConsecutiveBackNavigation(): Raw consecutive '../' at start (for trimming leading patterns)
 * - countBackNavigationOccurrences(): Total raw '../' count anywhere (for metadata analysis)
 */

/**
 * Minimal file representation for path utilities
 */
type URL = string;
type FileEntry = URL | { metadata?: boolean };

/**
 * Resolves a relative path by handling .. and . segments properly
 * This mimics path.resolve() behavior for relative paths
 * Returns the net back navigation steps after path resolution
 */
export function resolveRelativePath(relativePath: string): {
  resolvedPath: string;
  backSteps: number;
} {
  // Split the path into segments
  const segments = relativePath.split('/');
  const resolved: string[] = [];
  let backSteps = 0;

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      // Skip empty and current directory segments
      continue;
    } else if (segment === '..') {
      if (resolved.length > 0) {
        // Remove the last segment (go back one directory)
        resolved.pop();
      } else {
        // Count back steps that go beyond the current directory
        backSteps += 1;
      }
    } else {
      // Regular directory or file segment
      resolved.push(segment);
    }
  }

  return {
    resolvedPath: resolved.join('/'),
    backSteps,
  };
}

/**
 * Split a path into components, filtering out empty strings
 */
export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Extract URL path components, filtering out empty strings
 */
export function getUrlParts(url: string): string[] {
  return splitPath(new URL(url).pathname);
}

/**
 * Remove trailing slash from a path string
 */
export function removeTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Remove a specific number of back navigation prefixes from a path
 */
export function removeBackNavigationPrefix(path: string, count: number): string {
  let result = path;
  for (let i = 0; i < count; i += 1) {
    if (result.startsWith('../')) {
      result = result.slice(3);
    } else {
      break;
    }
  }
  return result;
}

/**
 * Calculate the maximum back navigation levels from a collection of file paths
 *
 * This function analyzes all file paths in the collection and determines:
 * 1. The maximum back navigation steps needed to reach any file (including metadata)
 * 2. The maximum back navigation steps needed to reach any non-metadata file
 *
 * @param files - Record of relative file paths to file content (string) or file objects with optional metadata flag
 * @returns Object containing:
 *   - maxBackNavigation: Maximum '../' steps needed to reach any file in the collection
 *   - maxSourceBackNavigation: Maximum '../' steps needed to reach any non-metadata file
 *
 * @example
 * ```typescript
 * const files = {
 *   'component.tsx': 'url',
 *   '../shared/utils.ts': 'url',
 *   '../../docs/readme.md': { metadata: true }
 * };
 *
 * const result = calculateMaxBackNavigation(files);
 * // result: { maxBackNavigation: 2, maxSourceBackNavigation: 1 }
 * ```
 */
export function calculateMaxBackNavigation(files: Record<string, FileEntry>): {
  maxBackNavigation: number;
  maxSourceBackNavigation: number;
} {
  let maxBackNavigation = 0;
  let maxSourceBackNavigation = 0;

  for (const [relativePath, fileContent] of Object.entries(files)) {
    // Check if this is a metadata file
    const isMetadata = typeof fileContent === 'object' && fileContent.metadata;

    const { backSteps } = resolveRelativePath(relativePath);
    if (!isMetadata) {
      maxSourceBackNavigation = Math.max(maxSourceBackNavigation, backSteps);
    }

    maxBackNavigation = Math.max(maxBackNavigation, backSteps);
  }

  return { maxBackNavigation, maxSourceBackNavigation };
}

/**
 * Calculate the maximum back navigation level from a collection of file paths
 *
 * This function analyzes file paths and determines the maximum number of back navigation
 * steps needed to reach any non-metadata file. It ignores metadata files completely,
 * focusing only on source code and other content files.
 *
 * @param files - Record of relative file paths to file content (string) or file objects with optional metadata flag
 * @returns The maximum number of `../` steps needed to reach any non-metadata file
 *
 * @example
 * ```typescript
 * const files = {
 *   'component.tsx': 'url',
 *   '../shared/utils.ts': 'url',
 *   '../../docs/readme.md': { metadata: true }, // ignored
 *   '../../../deep/source.js': 'url'
 * };
 *
 * const maxSteps = calculateMaxSourceBackNavigation(files);
 * // maxSteps: 3 (from '../../../deep/source.js')
 * ```
 */
export function calculateMaxSourceBackNavigation(files: Record<string, FileEntry>): number {
  let maxSourceBackNavigation = 0;

  for (const [relativePath, fileContent] of Object.entries(files)) {
    // Check if this is a metadata file
    const isMetadata = typeof fileContent === 'object' && fileContent.metadata;

    // Skip metadata files - only consider non-metadata files for maxSourceBackNavigation
    if (isMetadata) {
      continue;
    }

    // Use path resolution to get the net back steps (most accurate)
    const { backSteps } = resolveRelativePath(relativePath);
    maxSourceBackNavigation = Math.max(maxSourceBackNavigation, backSteps);
  }

  return maxSourceBackNavigation;
}

/**
 * Build a path from multiple components, filtering out empty parts
 */
export function buildPath(...segments: (string | string[] | undefined)[]): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment === undefined) {
      continue;
    }

    if (Array.isArray(segment)) {
      parts.push(...segment);
    } else {
      parts.push(segment);
    }
  }

  return parts.filter(Boolean).map(removeTrailingSlash).join('/');
}

/**
 * Create synthetic directory names for path structure
 * Generates alphabetic names: 'a', 'b', 'c', ..., 'z', 'aa', 'ab', 'ac', etc.
 * @param count - Number of directory names to generate
 * @returns Array of alphabetic directory names
 */
export function createSyntheticDirectories(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    let result = '';
    let num = i + 1; // 1-based for Excel-style naming

    while (num > 0) {
      num -= 1; // Adjust for 0-based indexing
      result = String.fromCharCode(97 + (num % 26)) + result;
      num = Math.floor(num / 26);
    }

    return result;
  });
}

/**
 * Calculate the required back navigation pattern for metadata files positioning.
 * This combines maxSourceBackNavigation from files with additional levels from metadataPrefix.
 *
 * @param files - Record of extraFiles to analyze for source back navigation
 * @param metadataPrefix - Optional prefix path (e.g., 'src/', 'src/app/') that adds additional back navigation levels
 * @returns A string of '../' patterns representing the back navigation needed
 *
 * @example
 * ```typescript
 * const files = { '../utils.ts': 'url', '../../shared.ts': 'url' };
 * const result = calculateMetadataBackNavigation(files, 'src/');
 * // result: '../../../' (maxSourceBackNavigation=2 + metadataPrefix=1)
 * ```
 */
export function calculateMetadataBackNavigation(
  files: Record<string, FileEntry> | undefined,
  metadataPrefix?: string,
): string {
  // Get the maxSourceBackNavigation from the file structure
  let backLevels = 0;

  if (files) {
    backLevels = calculateMaxSourceBackNavigation(files);
  }

  if (metadataPrefix) {
    // When a prefix is provided, add additional back navigation based on prefix depth
    const prefixSegments = metadataPrefix.split('/').filter(Boolean);
    backLevels += prefixSegments.length;
  }

  return '../'.repeat(backLevels);
}
