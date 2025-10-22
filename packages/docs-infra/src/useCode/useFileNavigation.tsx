import * as React from 'react';
import { decompressSync, strFromU8 } from 'fflate';
import type { Root as HastRoot } from 'hast';
import { decode } from 'uint8-to-base64';
import type { VariantCode, VariantSource, Code } from '../CodeHighlighter/types';
import { useUrlHashState } from '../useUrlHashState';
import { countLines } from '../pipeline/parseSource/addLineGutters';
import type { TransformedFiles } from './useCodeUtils';
import { Pre } from './Pre';

/**
 * Converts a string to kebab-case
 * @param str - The string to convert
 * @returns kebab-case string
 */
export function toKebabCase(str: string): string {
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
 * Checks if the URL hash is relevant to a specific demo
 * Hash format is: {mainSlug}:{variantName}:{fileName} or {mainSlug}:{fileName}
 * @param urlHash - The URL hash (without '#')
 * @param mainSlug - The main slug for the demo
 * @returns true if the hash starts with the demo's slug
 */
export function isHashRelevantToDemo(urlHash: string | null, mainSlug?: string): boolean {
  if (!urlHash || !mainSlug) {
    return false;
  }
  const kebabSlug = toKebabCase(mainSlug);
  return urlHash.startsWith(`${kebabSlug}:`);
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

interface UseFileNavigationProps {
  selectedVariant: VariantCode | null;
  transformedFiles: TransformedFiles | undefined;
  mainSlug?: string;
  selectedVariantKey?: string;
  variantKeys?: string[];
  shouldHighlight: boolean;
  initialVariant?: string;
  preClassName?: string;
  preRef?: React.Ref<HTMLPreElement>;
  effectiveCode?: Code;
  selectVariant?: React.Dispatch<React.SetStateAction<string>>;
}

export interface UseFileNavigationResult {
  selectedFileName: string | undefined;
  selectedFile: VariantSource | null;
  selectedFileComponent: React.ReactNode;
  selectedFileLines: number;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectFileName: (fileName: string) => void;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
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
  preClassName,
  preRef,
  effectiveCode,
  selectVariant,
}: UseFileNavigationProps): UseFileNavigationResult {
  // Keep selectedFileName as untransformed filename for internal tracking
  const [selectedFileNameInternal, setSelectedFileNameInternal] = React.useState<
    string | undefined
  >(selectedVariant?.fileName);

  // Track user interaction locally
  const [hasUserInteraction, setHasUserInteraction] = React.useState(false);

  // Helper to mark user interaction
  const markUserInteraction = React.useCallback(() => {
    setHasUserInteraction(true);
  }, []);

  // Use the simplified URL hash hook
  const [hash, setHash] = useUrlHashState();

  // Track if we're waiting for a variant switch to complete, and which file to select after
  const pendingFileSelection = React.useRef<string | null>(null);
  const justCompletedPendingSelection = React.useRef(false);
  const hashNavigationInProgressRef = React.useRef(false);

  // Track the previous variant and file to detect actual changes
  const prevVariantKeyRef = React.useRef<string | undefined>(undefined);
  const prevSelectedFileRef = React.useRef<string | undefined>(undefined);

  // Cleanup effect: ensure hashNavigationInProgressRef is cleared when hash changes
  // This prevents the flag from getting stuck if hash-driven navigation completes
  React.useEffect(() => {
    // Clear the flag when hash changes - this ensures we don't block future updates
    // if the flag was set from a previous hash-driven navigation
    return () => {
      hashNavigationInProgressRef.current = false;
    };
  }, [hash]);

  // Helper function to check URL hash and switch to matching file
  const checkUrlHashAndSelectFile = React.useCallback(() => {
    // If hash is empty/removed, reset to main file
    if (!hash) {
      if (selectedVariant?.fileName && selectedFileNameInternal !== selectedVariant.fileName) {
        setSelectedFileNameInternal(selectedVariant.fileName);
        setHasUserInteraction(true);
      }
      return;
    }

    // Try to find matching file - check current variant first
    let matchingFileName: string | undefined;
    let matchingVariantKey: string | undefined;

    // Step 1: Check current variant (if we have one)
    if (selectedVariant) {
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
          matchingVariantKey = selectedVariantKey;
        }
      }

      // Check extra files
      if (!matchingFileName && selectedVariant.extraFiles) {
        for (const fileName of Object.keys(selectedVariant.extraFiles)) {
          const fileSlug = generateFileSlug(
            mainSlug,
            fileName,
            selectedVariantKey,
            isInitialVariant,
          );
          if (hash === fileSlug) {
            matchingFileName = fileName;
            matchingVariantKey = selectedVariantKey;
            break;
          }
        }
      }

      // Check transformed files
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
            matchingVariantKey = selectedVariantKey;
            break;
          }
        }
      }
    }

    // Step 2: If no match and we can switch variants, search other variants
    if (!matchingFileName && effectiveCode && selectVariant) {
      for (const [variantKey, variant] of Object.entries(effectiveCode)) {
        // Skip current variant (already checked) and invalid variants
        if (variantKey === selectedVariantKey || !variant || typeof variant === 'string') {
          continue;
        }

        const isInitialVariant = initialVariant
          ? variantKey === initialVariant
          : variantKeys.length === 0 || variantKey === variantKeys[0];

        // Check main file
        if (variant.fileName) {
          const mainFileSlug = generateFileSlug(
            mainSlug,
            variant.fileName,
            variantKey,
            isInitialVariant,
          );
          if (hash === mainFileSlug) {
            matchingFileName = variant.fileName;
            matchingVariantKey = variantKey;
            break;
          }
        }

        // Check extra files
        if (!matchingFileName && variant.extraFiles) {
          for (const fileName of Object.keys(variant.extraFiles)) {
            const fileSlug = generateFileSlug(mainSlug, fileName, variantKey, isInitialVariant);
            if (hash === fileSlug) {
              matchingFileName = fileName;
              matchingVariantKey = variantKey;
              break;
            }
          }
        }

        if (matchingFileName) {
          break;
        }
      }
    }

    if (matchingFileName && matchingVariantKey) {
      hashNavigationInProgressRef.current = true;

      // If the matching file is in a different variant, switch to that variant first
      if (matchingVariantKey !== selectedVariantKey && selectVariant) {
        // Set pending file selection and switch variant
        // The pending file will be selected in the next render via useEffect
        pendingFileSelection.current = matchingFileName;
        selectVariant(matchingVariantKey);
        return;
      }

      // Set the file if we're in the correct variant
      pendingFileSelection.current = null;
      hashNavigationInProgressRef.current = true;
      setSelectedFileNameInternal(matchingFileName);
      // Don't mark as user interaction - this is hash-driven
    } else {
      hashNavigationInProgressRef.current = false;
    }
  }, [
    hash,
    selectedVariant,
    selectedVariantKey,
    variantKeys,
    initialVariant,
    mainSlug,
    transformedFiles,
    effectiveCode,
    selectVariant,
    selectedFileNameInternal,
  ]);

  // Run hash check when URL hash changes to select the matching file
  // Only depends on hash to avoid re-running when the callback recreates due to variant state changes
  React.useEffect(() => {
    // If there's a hash on mount, treat it as user interaction
    // (The user or a link brought them to this URL with a specific file selected)
    if (hash && !hasUserInteraction) {
      setHasUserInteraction(true);
    }
    checkUrlHashAndSelectFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  // When variant switches with a pending file selection, complete the file selection
  // Use useLayoutEffect to set file synchronously during the commit phase
  React.useLayoutEffect(() => {
    if (pendingFileSelection.current && selectedVariant) {
      const fileToSelect = pendingFileSelection.current;
      pendingFileSelection.current = null;
      justCompletedPendingSelection.current = true;
      hashNavigationInProgressRef.current = true;

      setSelectedFileNameInternal(fileToSelect);
    } else {
      justCompletedPendingSelection.current = false;
      if (!pendingFileSelection.current) {
        hashNavigationInProgressRef.current = false;
      }
    }
  }, [selectedVariantKey, selectedVariant]);

  // Reset selectedFileName when variant changes
  React.useEffect(() => {
    // Skip reset if we have a pending file selection from hash navigation
    // OR if we just completed a pending file selection
    if (pendingFileSelection.current || justCompletedPendingSelection.current) {
      return;
    }

    if (selectedVariant && selectedFileNameInternal !== selectedVariant.fileName) {
      // Only reset if current selectedFileName doesn't exist in the new variant
      const hasFile =
        selectedVariant.fileName === selectedFileNameInternal ||
        (selectedFileNameInternal &&
          selectedVariant.extraFiles &&
          selectedVariant.extraFiles[selectedFileNameInternal]);

      if (!hasFile) {
        setSelectedFileNameInternal(selectedVariant.fileName);
      } else {
        // File exists in new variant - clear hash navigation flag so hash can be updated
        // for the new variant in the next effect
        hashNavigationInProgressRef.current = false;
      }
    }
  }, [selectedVariant, selectedFileNameInternal, selectedVariantKey]);

  // Update URL when variant or file changes (to reflect new slug for current file)
  // This effect handles hash updates for:
  // 1. Variant changes (e.g., user switches from TypeScript to JavaScript)
  // 2. File changes that don't go through selectFileName (e.g., pending file selections after variant switch)
  // NOTE: selectFileName() has its own hash update logic, so direct file selections are covered
  React.useEffect(() => {
    if (!selectedVariant || typeof window === 'undefined' || !selectedFileNameInternal) {
      return;
    }

    // Check if variant or file actually changed (do this early to clear flags appropriately)
    const variantChanged = prevVariantKeyRef.current !== selectedVariantKey;
    const fileChanged = prevSelectedFileRef.current !== selectedFileNameInternal;

    // Allow hash updates only if:
    // 1. User has explicitly interacted (file selection, etc.), OR
    // 2. There's already a relevant hash present (user is navigating with URL hashes)
    // Don't update hash for programmatic changes (localStorage sync, initial load, etc.)
    const hasRelevantHash = isHashRelevantToDemo(hash, mainSlug);
    const shouldAllowHashUpdate = hasUserInteraction || hasRelevantHash;

    if (!shouldAllowHashUpdate) {
      return;
    }

    // Clear the flag when hash-driven navigation completes (variant or file changed).
    // Don't update the hash during hash navigation to avoid infinite loops.
    if (hashNavigationInProgressRef.current || pendingFileSelection.current) {
      if (variantChanged || fileChanged) {
        hashNavigationInProgressRef.current = false;
      }
      return;
    }

    // Only update hash when variant or file changes, not on every render
    // This prevents infinite loops when hash is manually edited
    if (!variantChanged && !fileChanged) {
      // Clear hash navigation flag - we're done processing
      hashNavigationInProgressRef.current = false;
      return;
    }

    // If this file change came from hash navigation AND variant didn't change,
    // don't update the hash again (prevents infinite loop).
    // But if variant changed, we DO want to update the hash to include the new variant.
    if (hashNavigationInProgressRef.current && !variantChanged) {
      hashNavigationInProgressRef.current = false;
      return;
    }

    // Clear the hash navigation flag - variant changed or we're allowing the update
    if (hashNavigationInProgressRef.current) {
      hashNavigationInProgressRef.current = false;
    }

    const isMainFile = selectedVariant.fileName === selectedFileNameInternal;
    const isExtraFile = Boolean(
      selectedVariant.extraFiles &&
        selectedVariant.extraFiles[selectedFileNameInternal] !== undefined,
    );
    const isTransformedFile = Boolean(
      transformedFiles?.files.some((file) => file.originalName === selectedFileNameInternal),
    );

    // Only proceed if the selected file exists in the variant
    if (!isMainFile && !isExtraFile && !isTransformedFile) {
      return;
    }

    prevVariantKeyRef.current = selectedVariantKey;
    prevSelectedFileRef.current = selectedFileNameInternal;

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

    // Only update the URL hash if it's different from current hash
    if (fileSlug && hash !== fileSlug) {
      // Only update if current hash is for the same demo (starts with mainSlug)
      // Don't set hash if there's no existing hash - variant changes shouldn't add hashes
      if (isHashRelevantToDemo(hash, mainSlug)) {
        setHash(fileSlug);
      }
      // Otherwise, don't update - either no hash exists or hash is for a different demo
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
    hash,
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
      return (
        <Pre className={preClassName} ref={preRef} shouldHighlight={shouldHighlight}>
          {selectedVariant.source}
        </Pre>
      );
    }

    // Look in extraFiles
    if (
      selectedFileNameInternal &&
      selectedVariant.extraFiles &&
      selectedVariant.extraFiles[selectedFileNameInternal]
    ) {
      const extraFile = selectedVariant.extraFiles[selectedFileNameInternal];
      let source: VariantSource | undefined;

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

      return (
        <Pre className={preClassName} ref={preRef} shouldHighlight={shouldHighlight}>
          {source}
        </Pre>
      );
    }

    return null;
  }, [
    selectedVariant,
    selectedFileNameInternal,
    transformedFiles,
    shouldHighlight,
    preClassName,
    preRef,
  ]);

  const selectedFileLines = React.useMemo(() => {
    if (selectedFile == null) {
      return 0;
    }

    // If it's a string, split by newlines and count
    if (typeof selectedFile === 'string') {
      return selectedFile.split('\n').length;
    }

    // If it's a hast object, count the children length
    if (selectedFile && typeof selectedFile === 'object') {
      let hastSelectedFile: HastRoot;
      if ('hastJson' in selectedFile) {
        hastSelectedFile = JSON.parse(selectedFile.hastJson);
      } else if ('hastGzip' in selectedFile) {
        hastSelectedFile = JSON.parse(strFromU8(decompressSync(decode(selectedFile.hastGzip))));
      } else {
        hastSelectedFile = selectedFile;
      }

      if (hastSelectedFile.data && 'totalLines' in hastSelectedFile.data) {
        const totalLines = hastSelectedFile.data.totalLines;
        // Check if totalLines is a valid number (not null, undefined, or NaN)
        if (totalLines != null && !Number.isNaN(Number(totalLines))) {
          const numLines = Number(totalLines);
          if (numLines >= 0) {
            return numLines;
          }
        }
        // Fall through to children count if totalLines is invalid
      }

      if ('children' in hastSelectedFile) {
        // Use countLines for more accurate line counting of HAST trees
        return countLines(hastSelectedFile);
      }
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
        component: (
          <Pre className={preClassName} ref={preRef} shouldHighlight={shouldHighlight}>
            {selectedVariant.source}
          </Pre>
        ),
      });
    }

    if (selectedVariant.extraFiles) {
      Object.entries(selectedVariant.extraFiles).forEach(([fileName, fileData]) => {
        let source: VariantSource | undefined;

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
          component: (
            <Pre className={preClassName} ref={preRef} shouldHighlight={shouldHighlight}>
              {source}
            </Pre>
          ),
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
    preClassName,
    preRef,
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
      if (typeof window !== 'undefined' && fileSlug && hash !== fileSlug) {
        setHash(fileSlug); // Use the new URL hash hook
      }

      hashNavigationInProgressRef.current = false;
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
      hash,
    ],
  );

  // Memoized array of all file slugs for all variants
  const allFilesSlugs = React.useMemo(() => {
    const result: Array<{ fileName: string; slug: string; variantName: string }> = [];

    if (!effectiveCode || !variantKeys.length) {
      return result;
    }

    // Iterate through all variants
    for (const variantKey of variantKeys) {
      const variant = effectiveCode[variantKey];

      // Skip invalid variants
      if (!variant || typeof variant === 'string') {
        continue;
      }

      // Determine if this is the initial variant
      const isInitialVariant = initialVariant
        ? variantKey === initialVariant
        : variantKeys.length === 0 || variantKey === variantKeys[0];

      // Add main file if it exists
      if (variant.fileName) {
        result.push({
          fileName: variant.fileName,
          slug: generateFileSlug(mainSlug, variant.fileName, variantKey, isInitialVariant),
          variantName: variantKey,
        });
      }

      // Add extra files
      if (variant.extraFiles) {
        Object.keys(variant.extraFiles).forEach((fileName) => {
          result.push({
            fileName,
            slug: generateFileSlug(mainSlug, fileName, variantKey, isInitialVariant),
            variantName: variantKey,
          });
        });
      }
    }

    return result;
  }, [effectiveCode, variantKeys, initialVariant, mainSlug]);

  return {
    selectedFileName,
    selectedFile,
    selectedFileComponent,
    selectedFileLines,
    files,
    allFilesSlugs,
    selectFileName,
  };
}
