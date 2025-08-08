/**
 * Flatten variant utility to convert a VariantCode into a flat files list
 * Handles relative path resolution and metadata file scoping
 * Uses addPathsToVariant for the core logic, then flattens the result
 */

import type { VariantCode, VariantSource } from '../CodeHighlighter/types';
import { stringOrHastToString } from '../pipeline/hastUtils';
import { addPathsToVariant } from '../CodeHighlighter/addPathsToVariant';

export interface FlatFile {
  source: string;
  metadata?: boolean;
}

export interface FlattenedFiles {
  [filePath: string]: FlatFile;
}

/**
 * Flatten a VariantCode into a flat files structure
 * Resolves relative paths and handles metadata file scoping
 * Uses addPathsToVariant for path resolution logic
 */
export function flattenVariant(variant: VariantCode): FlattenedFiles {
  const result: FlattenedFiles = {};

  // Use addPathsToVariant to get the structured paths
  const variantWithPaths = addPathsToVariant(variant);

  // Add main file if it exists
  if (variantWithPaths.path && variantWithPaths.source !== undefined) {
    result[variantWithPaths.path] = {
      source: stringOrHastToString(variantWithPaths.source),
    };
  }

  // Add extra files if they exist
  if (variantWithPaths.extraFiles) {
    for (const [relativePath, fileWithPath] of Object.entries(variantWithPaths.extraFiles)) {
      // Skip files with no source content
      if (!fileWithPath.source && fileWithPath.source !== '') {
        continue;
      }

      result[fileWithPath.path] = {
        source: stringOrHastToString(fileWithPath.source || ''),
        ...(fileWithPath.metadata && { metadata: fileWithPath.metadata }),
      };
    }
  }

  return result;
}
