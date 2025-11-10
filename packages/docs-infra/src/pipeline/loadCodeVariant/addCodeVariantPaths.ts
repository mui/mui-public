/**
 * Add path utility to add path property to each file in a variant
 * Uses calculateMainFilePath utility and URL resolution for simplified path calculation
 */

import type { VariantCode, VariantSource } from '../../CodeHighlighter/types';
import { calculateMaxBackNavigation, createSyntheticDirectories } from './pathUtils';
import { calculateMainFilePath } from './calculateMainFilePath';

export interface FileWithPath {
  source?: VariantSource;
  metadata?: boolean;
  path: string;
}

/**
 * Add flat paths to all files in a variant
 */
export function addPathsToVariant(variant: VariantCode): VariantCode {
  const url = variant.url || '';
  const fileName = variant.fileName || '';

  // Calculate actual back navigation needed based on extraFiles
  const backNavResult = variant.extraFiles
    ? calculateMaxBackNavigation(variant.extraFiles)
    : { maxBackNavigation: 0, maxSourceBackNavigation: 0 };

  // Create a synthetic URL for variants without URL to ensure consistent processing
  let effectiveUrl = url;
  if (!url && fileName) {
    effectiveUrl = `file:///${fileName}`;
  }

  // Calculate main file path using only the back navigation needed by source files
  const mainFileUrl = effectiveUrl
    ? calculateMainFilePath(
        effectiveUrl,
        backNavResult.maxBackNavigation,
        backNavResult.maxSourceBackNavigation,
        variant.metadataPrefix,
        fileName || undefined, // Only pass fileName if it's not empty
      )
    : undefined;

  // Extract just the path part from the file:// URL and remove leading slash
  const path = mainFileUrl ? new URL(mainFileUrl).pathname.slice(1) : undefined;

  return {
    ...variant,
    path,
    extraFiles: calculateExtraFilesPaths(
      variant.extraFiles,
      mainFileUrl ||
        `file:///${backNavResult.maxBackNavigation > 0 ? `${createSyntheticDirectories(backNavResult.maxBackNavigation).join('/')}/` : ''}temp.txt`,
    ),
  };
}

/**
 * Calculate paths for all extra files using the same logic as the main file
 */
function calculateExtraFilesPaths(
  extraFiles: VariantCode['extraFiles'],
  mainFileUrl: string,
): VariantCode['extraFiles'] | undefined {
  if (!extraFiles) {
    return undefined;
  }

  const result: { [fileName: string]: FileWithPath } = {};

  for (const [relativePath, fileContent] of Object.entries(extraFiles)) {
    // Resolve the relative path against the main file URL
    try {
      const resolvedUrl = new URL(relativePath, mainFileUrl);

      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;
      result[relativePath] = { ...file, path: resolvedUrl.pathname.slice(1) };
    } catch {
      // If URL resolution fails, skip this file
      continue;
    }
  }

  return { ...extraFiles, ...result };
}
