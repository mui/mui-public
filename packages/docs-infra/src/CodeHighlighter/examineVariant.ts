/**
 * Variant examination utility for analyzing variant structure and paths
 */

import type { VariantCode, VariantExtraFiles } from './types';
import { resolveRelativePath } from './pathUtils';

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
 * Calculate the maximum back navigation level from extra files
 * Only considers non-metadata files to determine the common back navigation
 */
function calculateMaxBackNavigation(extraFiles: VariantExtraFiles): number {
  let maxBackNavigation = 0;

  for (const [relativePath, fileContent] of Object.entries(extraFiles)) {
    const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;

    // Skip metadata files - only consider non-metadata files for maxBackNavigation
    if (file.metadata) {
      continue;
    }

    // Use proper path resolution to determine actual back steps for any path
    const { backSteps } = resolveRelativePath(relativePath);
    maxBackNavigation = Math.max(maxBackNavigation, backSteps);
  }

  return maxBackNavigation;
}

/**
 * Create path context for processing files with extended information
 */
export function createPathContext(variant: VariantCode): PathContext {
  const hasMetadata = variant.extraFiles
    ? Object.values(variant.extraFiles).some((file) => typeof file === 'object' && file.metadata)
    : false;

  // Calculate maxBackNavigation based only on extraFiles structure
  const maxBackNavigation = variant.extraFiles ? calculateMaxBackNavigation(variant.extraFiles) : 0;

  // Parse URL to determine path structure
  let urlDirectory: string[] = [];
  let rootLevel = '';
  let pathInwardFromRoot = '';

  if (variant.url && variant.url.includes('://')) {
    try {
      const url = new URL(variant.url);
      const pathname = url.pathname;

      // Split path into components, removing empty strings
      const pathComponents = pathname.split('/').filter(Boolean);

      if (pathComponents.length > 0) {
        // Check if the last component looks like a filename (has an extension)
        const lastComponent = pathComponents[pathComponents.length - 1];
        const hasFileExtension =
          lastComponent.includes('.') && /\.[a-zA-Z0-9]+$/.test(lastComponent);

        // If it has a file extension, exclude it from directory components
        const directoryComponents = hasFileExtension ? pathComponents.slice(0, -1) : pathComponents;

        urlDirectory = directoryComponents;
        rootLevel = directoryComponents[0] || '';

        // Only calculate pathInwardFromRoot if there's actual back navigation
        if (maxBackNavigation > 0 && directoryComponents.length >= maxBackNavigation) {
          // Take the last maxBackNavigation components as the pathInwardFromRoot
          const relevantComponents = directoryComponents.slice(-maxBackNavigation);
          pathInwardFromRoot = relevantComponents.join('/');
        }
      }
    } catch {
      // If URL parsing fails, keep defaults
      urlDirectory = [];
      rootLevel = '';
      pathInwardFromRoot = '';
    }
  }

  // We keep the URL info for compatibility, but don't use it for calculations
  const hasUrl = Boolean(variant.url);
  const actualUrl = variant.url;

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
