/**
 * Variant examination utility for analyzing variant structure and paths
 */

import type { VariantCode } from './types';
import { getUrlParts, calculateMaxSourceBackNavigation } from './pathUtils';

interface PathContextBase {
  hasMetadata: boolean;
  maxSourceBackNavigation: number;
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
 * Create path context for processing files with extended information
 */
export function createPathContext(variant: VariantCode): PathContext {
  const hasMetadata = variant.extraFiles
    ? Object.values(variant.extraFiles).some((file) => typeof file === 'object' && file.metadata)
    : false;

  // Calculate maxSourceBackNavigation based only on extraFiles structure
  const maxSourceBackNavigation = variant.extraFiles
    ? calculateMaxSourceBackNavigation(variant.extraFiles)
    : 0;

  // Parse URL to determine path structure
  let urlDirectory: string[] = [];
  let rootLevel = '';
  let pathInwardFromRoot = '';

  if (variant.url && variant.url.includes('://')) {
    try {
      const pathComponents = getUrlParts(variant.url);

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
        if (maxSourceBackNavigation > 0 && directoryComponents.length >= maxSourceBackNavigation) {
          // Take the last maxSourceBackNavigation components as the pathInwardFromRoot
          const relevantComponents = directoryComponents.slice(-maxSourceBackNavigation);
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
      maxSourceBackNavigation,
      urlDirectory,
      rootLevel,
      pathInwardFromRoot,
      actualUrl,
    } as PathContextWithUrl;
  }

  return {
    hasUrl: false,
    hasMetadata,
    maxSourceBackNavigation,
    urlDirectory,
    rootLevel,
    pathInwardFromRoot,
    actualUrl: undefined,
  } as PathContextWithoutUrl;
}
