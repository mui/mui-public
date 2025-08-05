import * as React from 'react';
import { stringOrHastToJsx } from '../pipeline/hastUtils';
import type { VariantSource } from '../CodeHighlighter/types';
import { useUrlHashState } from '../useUrlHashState';

type Source = VariantSource;

/**
 * Converts a string to kebab-case
 * @param str - The string to convert
 * @returns kebab-case string
 */
function toKebabCase(str: string): string {
  return (
    str
      // Insert a dash before any uppercase letter that follows a lowercase letter or digit
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Generates a file slug based on main slug, file name, and variant name
 * @param mainSlug - The main component/demo slug
 * @param fileName - The file name
 * @param variantName - The variant name
 * @param isInitialVariant - Whether this is the initial/default variant
 * @returns Generated file slug
 */
function generateFileSlug(
  mainSlug: string,
  fileName: string,
  variantName: string,
  isInitialVariant: boolean,
): string {
  // Extract base name from filename (strip extension)
  const lastDotIndex = fileName.lastIndexOf('.');
  const baseName = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
  const extension = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : '';

  // Convert to kebab-case
  const kebabMainSlug = toKebabCase(mainSlug);
  const kebabBaseName = toKebabCase(baseName);
  const kebabVariantName = toKebabCase(variantName);

  // Reconstruct filename with kebab-case base name but preserved extension
  const kebabFileName = `${kebabBaseName}${extension}`;

  // Handle empty main slug case
  if (!kebabMainSlug) {
    return kebabFileName;
  }

  // Format: mainSlug:fileName.ext (for initial variant) or mainSlug:variantName:fileName.ext
  if (isInitialVariant) {
    return `${kebabMainSlug}:${kebabFileName}`;
  }

  return `${kebabMainSlug}:${kebabVariantName}:${kebabFileName}`;
}

interface TransformedFile {
  name: string;
  originalName: string;
  source: Source;
  component: React.ReactNode;
}

interface TransformedFiles {
  files: TransformedFile[];
  filenameMap: { [originalName: string]: string };
}

interface UseFileNavigationProps {
  selectedVariant: any;
  transformedFiles: TransformedFiles | undefined;
  mainSlug?: string;
  selectedVariantKey?: string;
  variantKeys?: string[];
  shouldHighlight: boolean;
  initialVariant?: string;
}

export interface UseFileNavigationResult {
  selectedFileName: string | undefined;
  selectedFile: any;
  selectedFileComponent: React.ReactNode;
  selectedFileLines: number;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectFileName: (fileName: string) => void;
}

/**
 * Hook for managing file selection and navigation within a code variant
 */
export function useFileNavigation({
  selectedVariant,
  transformedFiles,
  mainSlug = '',
  selectedVariantKey = '',
  variantKeys = [],
  initialVariant,
  shouldHighlight,
}: UseFileNavigationProps): UseFileNavigationResult {
  // Keep selectedFileName as untransformed filename for internal tracking
  const [selectedFileNameInternal, setSelectedFileNameInternal] = React.useState<
    string | undefined
  >(selectedVariant?.fileName);

  // Use the new URL hash hook
  const { hash, setHash, hasUserInteraction, markUserInteraction } = useUrlHashState();

  // Helper function to check URL hash and switch to matching file
  const checkUrlHashAndSelectFile = React.useCallback(() => {
    if (!selectedVariant || !hash) {
      return;
    }

    // Check if hash matches any file slug
    let matchingFileName: string | undefined;

    // Determine if this is the initial variant
    const isInitialVariant = initialVariant
      ? selectedVariantKey === initialVariant
      : variantKeys.length === 0 || selectedVariantKey === variantKeys[0];

    // Check main file
    if (selectedVariant.fileName) {
      const mainFileSlug = generateFileSlug(
        mainSlug,
        selectedVariant.fileName,
        selectedVariantKey,
        isInitialVariant,
      );
      if (hash === mainFileSlug) {
        matchingFileName = selectedVariant.fileName;
      }
    }

    // Check extra files
    if (!matchingFileName && selectedVariant.extraFiles) {
      for (const fileName of Object.keys(selectedVariant.extraFiles)) {
        const fileSlug = generateFileSlug(mainSlug, fileName, selectedVariantKey, isInitialVariant);
        if (hash === fileSlug) {
          matchingFileName = fileName;
          break;
        }
      }
    }

    // Check transformed files if available
    if (!matchingFileName && transformedFiles) {
      for (const file of transformedFiles.files) {
        const fileSlug = generateFileSlug(
          mainSlug,
          file.originalName,
          selectedVariantKey,
          isInitialVariant,
        );
        if (hash === fileSlug) {
          matchingFileName = file.originalName;
          break;
        }
      }
    }

    if (matchingFileName) {
      setSelectedFileNameInternal(matchingFileName);
      markUserInteraction(); // Mark that user has made a selection via URL
    }
  }, [
    selectedVariant,
    hash,
    transformedFiles,
    mainSlug,
    selectedVariantKey,
    variantKeys,
    initialVariant,
    markUserInteraction,
  ]);

  // On hydration/variant change, check URL hash and switch to matching file
  React.useEffect(() => {
    checkUrlHashAndSelectFile();
  }, [checkUrlHashAndSelectFile]);

  // Reset selectedFileName when variant changes
  React.useEffect(() => {
    if (selectedVariant && selectedFileNameInternal !== selectedVariant.fileName) {
      // Only reset if current selectedFileName doesn't exist in the new variant
      const hasFile =
        selectedVariant.fileName === selectedFileNameInternal ||
        (selectedFileNameInternal &&
          selectedVariant.extraFiles &&
          selectedVariant.extraFiles[selectedFileNameInternal]);

      if (!hasFile) {
        setSelectedFileNameInternal(selectedVariant.fileName);
      }
    }
  }, [selectedVariant, selectedFileNameInternal]);

  // Update URL when variant changes (to reflect new slug for current file)
  React.useEffect(() => {
    if (
      !selectedVariant ||
      typeof window === 'undefined' ||
      !selectedFileNameInternal ||
      !hasUserInteraction
    ) {
      return;
    }

    // Determine if this is the initial variant
    const isInitialVariant = initialVariant
      ? selectedVariantKey === initialVariant
      : variantKeys.length === 0 || selectedVariantKey === variantKeys[0];

    // Generate the new slug for the currently selected file
    let fileSlug = '';

    if (transformedFiles) {
      const file = transformedFiles.files.find((f) => f.originalName === selectedFileNameInternal);
      if (file) {
        fileSlug = generateFileSlug(
          mainSlug,
          file.originalName,
          selectedVariantKey,
          isInitialVariant,
        );
      }
    } else {
      fileSlug = generateFileSlug(
        mainSlug,
        selectedFileNameInternal,
        selectedVariantKey,
        isInitialVariant,
      );
    }

    // Update the URL hash without adding to history (replaceState)
    if (fileSlug) {
      setHash(fileSlug); // Use the new URL hash hook
    }
  }, [
    selectedVariant,
    selectedFileNameInternal,
    transformedFiles,
    mainSlug,
    selectedVariantKey,
    variantKeys,
    initialVariant,
    hasUserInteraction,
    setHash,
  ]);

  // Compute the displayed filename (transformed if applicable)
  const selectedFileName = React.useMemo(() => {
    if (!selectedVariant) {
      return undefined;
    }

    // If selectedFileNameInternal is undefined, we're selecting the main file
    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName) {
      return undefined;
    }

    // If we have transformed files, return the transformed name
    if (transformedFiles) {
      const file = transformedFiles.files.find((f) => f.originalName === effectiveFileName);
      return file ? file.name : effectiveFileName;
    }

    // Otherwise, return the original filename
    return effectiveFileName;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  const selectedFile = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }

    // If we have transformed files, use them
    if (transformedFiles) {
      const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
      const file = transformedFiles.files.find((f) => f.originalName === effectiveFileName);
      return file ? file.source : null;
    }

    // Otherwise, use the original untransformed files
    if (selectedFileNameInternal === selectedVariant.fileName || !selectedFileNameInternal) {
      return selectedVariant.source ?? null;
    }

    // Look in extraFiles
    if (
      selectedFileNameInternal &&
      selectedVariant.extraFiles &&
      selectedVariant.extraFiles[selectedFileNameInternal]
    ) {
      const extraFile = selectedVariant.extraFiles[selectedFileNameInternal];
      if (typeof extraFile === 'string') {
        return extraFile;
      }
      if (extraFile && typeof extraFile === 'object' && 'source' in extraFile) {
        return extraFile.source ?? null;
      }
    }

    return null;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  const selectedFileComponent = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }

    // If we have transformed files, use them
    if (transformedFiles) {
      const file = transformedFiles.files.find((f) => f.originalName === selectedFileNameInternal);
      return file ? file.component : null;
    }

    // Otherwise, create component from original untransformed files
    if (selectedFileNameInternal === selectedVariant.fileName || !selectedFileNameInternal) {
      if (selectedVariant.source == null) {
        return null;
      }
      return stringOrHastToJsx(selectedVariant.source as Source, shouldHighlight);
    }

    // Look in extraFiles
    if (
      selectedFileNameInternal &&
      selectedVariant.extraFiles &&
      selectedVariant.extraFiles[selectedFileNameInternal]
    ) {
      const extraFile = selectedVariant.extraFiles[selectedFileNameInternal];
      let source: any;

      if (typeof extraFile === 'string') {
        source = extraFile;
      } else if (extraFile && typeof extraFile === 'object' && 'source' in extraFile) {
        source = extraFile.source;
      } else {
        return null;
      }

      if (source == null) {
        return null;
      }

      return stringOrHastToJsx(source as Source, shouldHighlight);
    }

    return null;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles, shouldHighlight]);

  const selectedFileLines = React.useMemo(() => {
    if (selectedFile == null) {
      return 0;
    }

    // If it's a string, split by newlines and count
    if (typeof selectedFile === 'string') {
      return selectedFile.split('\n').length;
    }

    // If it's a hast object, count the children length
    if (selectedFile && typeof selectedFile === 'object' && 'children' in selectedFile) {
      return Array.isArray(selectedFile.children) ? selectedFile.children.length : 0;
    }

    return 0;
  }, [selectedFile]);

  // Convert files for the return interface
  const files = React.useMemo(() => {
    if (!selectedVariant) {
      return [];
    }

    // Determine if this is the initial variant
    const isInitialVariant = initialVariant
      ? selectedVariantKey === initialVariant
      : variantKeys.length === 0 || selectedVariantKey === variantKeys[0];

    // If we have transformed files, use them
    if (transformedFiles) {
      return transformedFiles.files.map((f) => ({
        name: f.name,
        slug: generateFileSlug(mainSlug, f.originalName, selectedVariantKey, isInitialVariant),
        component: f.component,
      }));
    }

    // Otherwise, create files from original untransformed data
    const result: Array<{ name: string; slug?: string; component: React.ReactNode }> = [];

    // Only add main file if it has a fileName
    if (selectedVariant.fileName && selectedVariant.source) {
      result.push({
        name: selectedVariant.fileName,
        slug: generateFileSlug(
          mainSlug,
          selectedVariant.fileName,
          selectedVariantKey,
          isInitialVariant,
        ),
        component: stringOrHastToJsx(selectedVariant.source as Source, shouldHighlight),
      });
    }

    if (selectedVariant.extraFiles) {
      Object.entries(selectedVariant.extraFiles).forEach(([fileName, fileData]) => {
        let source: any;

        if (typeof fileData === 'string') {
          source = fileData;
        } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
          source = fileData.source;
        } else {
          return; // Skip invalid entries
        }

        if (!source) {
          return; // Skip null/undefined sources
        }

        result.push({
          name: fileName,
          slug: generateFileSlug(mainSlug, fileName, selectedVariantKey, isInitialVariant),
          component: stringOrHastToJsx(source as Source, shouldHighlight),
        });
      });
    }

    return result;
  }, [
    selectedVariant,
    transformedFiles,
    mainSlug,
    selectedVariantKey,
    variantKeys,
    initialVariant,
    shouldHighlight,
  ]);

  // Create a wrapper for selectFileName that handles transformed filenames and URL updates
  const selectFileName = React.useCallback(
    (fileName: string) => {
      if (!selectedVariant) {
        return;
      }

      let targetFileName = fileName;
      let fileSlug = '';

      // Determine if this is the initial variant
      const isInitialVariant = initialVariant
        ? selectedVariantKey === initialVariant
        : variantKeys.length === 0 || selectedVariantKey === variantKeys[0];

      // If we have transformed files, we need to reverse-lookup the original filename
      if (transformedFiles) {
        // Check if the fileName is a transformed name - if so, find the original
        const fileByTransformedName = transformedFiles.files.find((f) => f.name === fileName);
        if (fileByTransformedName) {
          targetFileName = fileByTransformedName.originalName;
          fileSlug = generateFileSlug(
            mainSlug,
            fileByTransformedName.originalName,
            selectedVariantKey,
            isInitialVariant,
          );
        } else {
          // Check if the fileName is already an original name
          const fileByOriginalName = transformedFiles.files.find(
            (f) => f.originalName === fileName,
          );
          if (fileByOriginalName) {
            targetFileName = fileName;
            fileSlug = generateFileSlug(mainSlug, fileName, selectedVariantKey, isInitialVariant);
          }
        }
      } else {
        // No transformed files, generate slug directly
        fileSlug = generateFileSlug(mainSlug, fileName, selectedVariantKey, isInitialVariant);
      }

      // Update the URL hash without adding to history (replaceState)
      if (typeof window !== 'undefined' && fileSlug) {
        setHash(fileSlug); // Use the new URL hash hook
      }

      markUserInteraction(); // Mark that user has made an explicit selection
      setSelectedFileNameInternal(targetFileName);
    },
    [
      selectedVariant,
      transformedFiles,
      mainSlug,
      selectedVariantKey,
      variantKeys,
      initialVariant,
      setHash,
      markUserInteraction,
    ],
  );

  return {
    selectedFileName,
    selectedFile,
    selectedFileComponent,
    selectedFileLines,
    files,
    selectFileName,
  };
}
