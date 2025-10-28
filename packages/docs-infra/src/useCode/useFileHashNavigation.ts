import * as React from 'react';
import type { VariantCode, Code } from '../CodeHighlighter/types';
import { useUrlHashState } from '../useUrlHashState';
import type { TransformedFiles } from './useCodeUtils';
import { isHashRelevantToDemo } from './useFileNavigation';

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
 * Generates a simplified hash with just the demo slug
 * Used when avoidMutatingAddressBar is true
 * @param mainSlug - The main component/demo slug
 * @returns Generated demo slug (just the slug, no variant or file)
 */
function generateDemoSlug(mainSlug: string): string {
  const kebabMainSlug = toKebabCase(mainSlug);

  // Handle empty main slug case
  if (!kebabMainSlug) {
    return '';
  }

  // Format: just mainSlug (no variant, no file)
  return kebabMainSlug;
}

interface UseFileHashNavigationProps {
  selectedVariant: VariantCode | null;
  selectedFileNameInternal: string | undefined;
  setSelectedFileNameInternal: (fileName: string | undefined) => void;
  transformedFiles: TransformedFiles | undefined;
  mainSlug: string;
  selectedVariantKey: string;
  variantKeys: string[];
  initialVariant?: string;
  effectiveCode?: Code;
  selectVariant?: React.Dispatch<React.SetStateAction<string>>;
  avoidMutatingAddressBar?: boolean;
  fileHashAfterRead?: 'preserve' | 'demo' | 'remove';
}

export interface UseFileHashNavigationResult {
  selectFileName: (fileName: string) => void;
  hash: string | null;
}

/**
 * Hook for managing URL hash synchronization with file navigation
 * Handles bi-directional sync between URL hash and selected file state
 */
export function useFileHashNavigation({
  selectedVariant,
  selectedFileNameInternal,
  setSelectedFileNameInternal,
  transformedFiles,
  mainSlug,
  selectedVariantKey,
  variantKeys,
  initialVariant,
  effectiveCode,
  selectVariant,
  avoidMutatingAddressBar = false,
  fileHashAfterRead = 'preserve',
}: UseFileHashNavigationProps): UseFileHashNavigationResult {
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

  // Track if we've already cleaned the hash after reading it (for fileHashAfterRead flag)
  const hasCleanedHashAfterRead = React.useRef(false);

  // Track the previous variant and file to detect actual changes
  const prevVariantKeyRef = React.useRef<string | undefined>(undefined);
  const prevSelectedFileRef = React.useRef<string | undefined>(undefined);

  // Cleanup effect: ensure hashNavigationInProgressRef is cleared when hash changes
  // This prevents the flag from getting stuck if hash-driven navigation completes
  React.useEffect(() => {
    // Reset the cleaned flag when hash changes externally (not from us cleaning it)
    // This allows subsequent hash changes to also be cleaned
    if (hash && !hashNavigationInProgressRef.current) {
      hasCleanedHashAfterRead.current = false;
    }

    // Clear the flag when hash changes - this ensures we don't block future updates
    // if the flag was set from a previous hash-driven navigation
    return () => {
      hashNavigationInProgressRef.current = false;
    };
  }, [hash]);

  // Helper function to check URL hash and switch to matching file
  const checkUrlHashAndSelectFile = React.useCallback(() => {
    // If hash is empty/removed, reset to main file
    // But don't reset if we just cleaned the hash ourselves (hasCleanedHashAfterRead tracks this)
    if (!hash) {
      if (
        !hasCleanedHashAfterRead.current &&
        selectedVariant?.fileName &&
        selectedFileNameInternal !== selectedVariant.fileName
      ) {
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

      // Handle hash cleaning for same-variant file selection
      if (!hasCleanedHashAfterRead.current) {
        if (fileHashAfterRead === 'remove') {
          // Completely remove the hash from the URL
          if (hash) {
            setHash(null);
            hasCleanedHashAfterRead.current = true;
          }
        } else if (fileHashAfterRead === 'demo' || avoidMutatingAddressBar) {
          // Clean up the hash to just show demo slug
          const cleanHash = generateDemoSlug(mainSlug);
          if (cleanHash && hash !== cleanHash) {
            setHash(cleanHash);
            hasCleanedHashAfterRead.current = true;
          }
        }
      }
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
    setSelectedFileNameInternal,
    avoidMutatingAddressBar,
    fileHashAfterRead,
    setHash,
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

      // Handle hash cleaning based on flags - only after completing the cross-variant navigation
      if (!hasCleanedHashAfterRead.current) {
        if (fileHashAfterRead === 'remove') {
          // Completely remove the hash from the URL
          if (hash) {
            setHash(null);
            hasCleanedHashAfterRead.current = true;
          }
        } else if (fileHashAfterRead === 'demo' || avoidMutatingAddressBar) {
          // Clean up the hash to just show demo slug
          const cleanHash = generateDemoSlug(mainSlug);
          if (cleanHash && hash !== cleanHash) {
            setHash(cleanHash);
            hasCleanedHashAfterRead.current = true;
          }
        }
      }
    } else {
      justCompletedPendingSelection.current = false;
      if (!pendingFileSelection.current) {
        hashNavigationInProgressRef.current = false;
      }
    }
    // Only depend on variant changes - hash/setHash are stable and shouldn't trigger re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantKey, selectedVariant, setSelectedFileNameInternal]);

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
  }, [selectedVariant, selectedFileNameInternal, selectedVariantKey, setSelectedFileNameInternal]);

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
        // Handle hash cleaning/removal based on flags
        if (fileHashAfterRead === 'remove') {
          // Completely remove the hash from the URL
          if (hash) {
            setHash(null);
          }
        } else if (fileHashAfterRead === 'demo' || avoidMutatingAddressBar) {
          // Clean existing hash to just slug
          const cleanHash = generateDemoSlug(mainSlug);
          if (cleanHash && hash !== cleanHash) {
            setHash(cleanHash);
          }
        } else {
          setHash(fileSlug);
        }
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
    avoidMutatingAddressBar,
    fileHashAfterRead,
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
        // Handle hash cleaning/removal based on flags
        if (fileHashAfterRead === 'remove') {
          // Completely remove the hash from the URL
          if (hash) {
            setHash(null);
          }
        } else if (fileHashAfterRead === 'demo' || avoidMutatingAddressBar) {
          // Only clean existing relevant hash, don't add a new hash if none exists
          if (isHashRelevantToDemo(hash, mainSlug)) {
            const cleanHash = generateDemoSlug(mainSlug);
            if (cleanHash && hash !== cleanHash) {
              setHash(cleanHash);
            }
          }
          // Otherwise don't set any hash - avoid adding one
        } else {
          setHash(fileSlug);
        }
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
      setSelectedFileNameInternal,
      avoidMutatingAddressBar,
      fileHashAfterRead,
    ],
  );

  return {
    selectFileName,
    hash,
  };
}
