/**
 * Metadata merging utility for positioning metadata files relative to source files
 */

import type { VariantCode, VariantExtraFiles } from './types';
import { createPathContext } from './examineVariant';

/**
 * Options for merging metadata files
 */
interface MergeMetadataOptions {
  /**
   * Optional prefix indicating where source files will be placed.
   * When provided, metadata files will be positioned relative to this prefix
   * PLUS the existing maxBackNavigation from the variant structure.
   *
   * Examples (assuming maxBackNavigation = 2):
   * - 'src/' -> metadata goes to '../../../' (maxBackNavigation + 1 for src/)
   * - 'src/app/' -> metadata goes to '../../../../' (maxBackNavigation + 2 for src/app/)
   * - undefined -> uses only maxBackNavigation (for client merging)
   */
  metadataPrefix?: string;
}

/**
 * Calculate the required back navigation level for metadata files
 */
function calculateMetadataBackNavigation(variant: VariantCode, metadataPrefix?: string): string {
  // Get the maxBackNavigation from the variant's file structure
  const pathContext = createPathContext(variant);
  let backLevels = pathContext.maxBackNavigation;

  if (metadataPrefix) {
    // When a prefix is provided, add additional back navigation based on prefix depth
    const prefixSegments = metadataPrefix.split('/').filter(Boolean);
    backLevels += prefixSegments.length;
  }

  return '../'.repeat(backLevels);
}

/**
 * Merge metadata files into a variant with proper positioning
 *
 * @param variant - The variant containing source files and potentially mixed metadata/non-metadata files
 * @param metadataFiles - Additional metadata files to merge in
 * @param options - Options for metadata positioning
 * @returns A variant with all metadata files properly positioned
 */
/**
 * Extract metadata files from a variant, scoping them according to metadataPrefix
 *
 * @param variant - The variant containing mixed source and metadata files
 * @returns An object with the cleaned variant and extracted metadata
 */
export function extractMetadata(variant: VariantCode): {
  variant: VariantCode;
  metadata: VariantExtraFiles;
} {
  const { metadataPrefix } = variant;
  const extractedMetadata: VariantExtraFiles = {};
  const nonMetadataFiles: VariantExtraFiles = {};

  if (!variant.extraFiles) {
    return {
      variant: { ...variant, extraFiles: {} },
      metadata: {},
    };
  }

  // Process all extraFiles
  for (const [relativePath, fileContent] of Object.entries(variant.extraFiles)) {
    const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;

    if (file.metadata) {
      let scopedPath = relativePath;

      // Calculate how much back navigation to remove
      const pathContext = createPathContext(variant);
      let backLevelsToRemove = pathContext.maxBackNavigation;

      if (metadataPrefix) {
        // Add metadataPrefix levels if present
        backLevelsToRemove += metadataPrefix.split('/').filter(Boolean).length;
      }

      // Remove the back navigation prefix to scope metadata correctly
      if (backLevelsToRemove > 0) {
        const backNavigationToRemove = '../'.repeat(backLevelsToRemove);
        if (scopedPath.startsWith(backNavigationToRemove)) {
          scopedPath = scopedPath.slice(backNavigationToRemove.length);
        }
      }

      // Remove metadata flag when extracting
      const { metadata: metadataFlag, ...cleanFile } = file;
      extractedMetadata[scopedPath] = cleanFile;
    } else {
      nonMetadataFiles[relativePath] = file;
    }
  }

  return {
    variant: {
      ...variant,
      extraFiles: nonMetadataFiles,
    },
    metadata: extractedMetadata,
  };
}

export function mergeMetadata(
  variant: VariantCode,
  metadataFiles: VariantExtraFiles = {},
  options: MergeMetadataOptions = {},
): VariantCode {
  // Determine which metadataPrefix to use
  const targetMetadataPrefix = options.metadataPrefix ?? variant.metadataPrefix;

  // Check if we need to re-extract metadata due to metadataPrefix change
  const needsReextraction =
    options.metadataPrefix !== undefined && options.metadataPrefix !== variant.metadataPrefix;

  // If metadataPrefix is changing, extract existing metadata and reposition everything
  let workingVariant = variant;
  let existingMetadata: VariantExtraFiles = {};

  if (needsReextraction && variant.extraFiles) {
    // Extract existing metadata using the old metadataPrefix
    const extracted = extractMetadata(variant);
    workingVariant = extracted.variant;
    existingMetadata = extracted.metadata;
  }

  // Calculate the positioning level for metadata files
  const metadataBackNavigation = calculateMetadataBackNavigation(
    workingVariant,
    targetMetadataPrefix,
  );

  // Collect all metadata files that need positioning
  const allMetadataFiles: VariantExtraFiles = {};
  const nonMetadataFiles: VariantExtraFiles = {};
  const positionedMetadataFiles: VariantExtraFiles = {};

  // Process existing extraFiles from working variant
  if (workingVariant.extraFiles) {
    for (const [relativePath, fileContent] of Object.entries(workingVariant.extraFiles)) {
      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;

      if (file.metadata) {
        // If we're not changing metadataPrefix, keep existing metadata files where they are
        if (!needsReextraction) {
          positionedMetadataFiles[relativePath] = file;
        } else {
          // Only collect for repositioning if metadataPrefix is changing
          allMetadataFiles[relativePath] = file;
        }
      } else {
        nonMetadataFiles[relativePath] = file;
      }
    }
  }

  // Add extracted metadata (if any) for repositioning
  for (const [filePath, file] of Object.entries(existingMetadata)) {
    allMetadataFiles[filePath] = {
      ...(typeof file === 'string' ? { source: file } : file),
      metadata: true,
    };
  }

  // Add additional metadata files for positioning
  for (const [filePath, file] of Object.entries(metadataFiles)) {
    allMetadataFiles[filePath] = {
      ...(typeof file === 'string' ? { source: file } : file),
      metadata: true,
    };
  }

  // Position new metadata files at the calculated level
  for (const [originalPath, file] of Object.entries(allMetadataFiles)) {
    const metadataPath = `${metadataBackNavigation}${originalPath}`;
    positionedMetadataFiles[metadataPath] = file;
  }

  // Combine all files
  const finalExtraFiles = {
    ...nonMetadataFiles,
    ...positionedMetadataFiles,
  };

  return {
    ...workingVariant,
    extraFiles: finalExtraFiles,
    metadataPrefix: targetMetadataPrefix,
  };
}
