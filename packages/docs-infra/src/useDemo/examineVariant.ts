/**
 * Variant examination utility for analyzing variant structure and paths
 */

import type { VariantCode } from '../CodeHighlighter/types';

interface PathContextBase {
  hasMetadata: boolean;
  maxBackNavigation: number;
  urlDirectory: string[];
  rootLevel: string;
  pathInwardFromRoot: string;
}

interface PathContextWithUrl extends PathContextBase {
  hasUrl: true;
  actualUrl: string;
}

interface PathContextWithoutUrl extends PathContextBase {
  hasUrl: false;
  actualUrl?: undefined;
}

export type PathContext = PathContextWithUrl | PathContextWithoutUrl;

/**
 * Extract directory segments from URL pathname
 */
function getDirectoryFromUrl(url: string): string[] {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split('/').filter(Boolean);
  segments.pop(); // Remove filename
  return segments;
}

/**
 * Calculate the maximum back navigation level from extra files
 */
function calculateMaxBackNavigation(extraFiles: Record<string, any>): number {
  let maxBackNavigation = 0;

  for (const [relativePath, fileContent] of Object.entries(extraFiles)) {
    if (relativePath.startsWith('.')) {
      const backCount = (relativePath.match(/\.\.\//g) || []).length;

      // For metadata files, subtract 1 from their back navigation count
      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;
      const adjustedBackCount = file.metadata ? Math.max(0, backCount - 1) : backCount;

      maxBackNavigation = Math.max(maxBackNavigation, adjustedBackCount);
    }
  }

  return maxBackNavigation;
}

/**
 * Generate a synthetic path using alphabetic progression (a/b/c/d/e/...)
 */
function generateSyntheticPath(levels: number): string {
  if (levels <= 0) {
    return '';
  }

  const parts: string[] = [];
  for (let i = 0; i < levels; i += 1) {
    const charCode = 97 + (i % 26); // 97 is 'a', cycles through a-z
    parts.push(String.fromCharCode(charCode));
  }

  return parts.join('/') + (levels > 0 ? '/' : '');
}

/**
 * Calculate root level path based on URL and max back navigation
 */
function calculateRootLevel(url: string | undefined, maxBackNavigation: number): string {
  if (!url || maxBackNavigation === 0) {
    return '';
  }

  const pathSegments = getDirectoryFromUrl(url);

  // Go back by maxBackNavigation levels
  for (let i = 0; i < maxBackNavigation; i += 1) {
    pathSegments.pop();
  }

  const rootLevel = pathSegments.join('/');
  return rootLevel && !rootLevel.endsWith('/') ? `${rootLevel}/` : rootLevel;
}

/**
 * Calculate the path inward from the root to the variant location
 */
function calculatePathInwardFromRoot(url: string | undefined, maxBackNavigation: number): string {
  if (!url || maxBackNavigation === 0) {
    return '';
  }

  const pathSegments = getDirectoryFromUrl(url);

  // The path inward is the segments that remain after going back by maxBackNavigation
  // but we want the path from root to the variant location, not to the parent directory
  const variantDepthFromRoot = pathSegments.length - maxBackNavigation;

  if (variantDepthFromRoot <= 0) {
    return '';
  }

  // Get segments starting from the root level up to (but not including) the current directory
  const rootSegments = pathSegments.slice(0, pathSegments.length - maxBackNavigation);
  const variantSegments = pathSegments.slice(rootSegments.length);

  return variantSegments.length > 0 ? `${variantSegments.join('/')}/` : '';
}

/**
 * Create path context for processing files with extended information
 */
export function createPathContext(variant: VariantCode): PathContext {
  let hasUrl = Boolean(variant.url);
  let actualUrl = variant.url;

  const hasMetadata = variant.extraFiles
    ? Object.values(variant.extraFiles).some((file) => typeof file === 'object' && file.metadata)
    : false;

  const maxBackNavigation = variant.extraFiles ? calculateMaxBackNavigation(variant.extraFiles) : 0;

  // If no URL but we have back navigation, create a synthetic URL
  if (!hasUrl && maxBackNavigation > 0 && variant.fileName) {
    const syntheticPath = generateSyntheticPath(maxBackNavigation);
    actualUrl = `file:///${syntheticPath}${variant.fileName}`;
    hasUrl = true;
  }

  const urlDirectory = hasUrl && actualUrl ? getDirectoryFromUrl(actualUrl) : [];
  const rootLevel = calculateRootLevel(actualUrl, maxBackNavigation);
  const pathInwardFromRoot = calculatePathInwardFromRoot(actualUrl, maxBackNavigation);

  if (hasUrl && actualUrl) {
    return {
      hasUrl: true,
      hasMetadata,
      maxBackNavigation,
      urlDirectory,
      rootLevel,
      pathInwardFromRoot,
      actualUrl,
    } as PathContextWithUrl;
  }

  return {
    hasUrl: false,
    hasMetadata,
    maxBackNavigation,
    urlDirectory,
    rootLevel,
    pathInwardFromRoot,
    actualUrl: undefined,
  } as PathContextWithoutUrl;
}
