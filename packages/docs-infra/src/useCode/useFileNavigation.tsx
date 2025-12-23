import * as React from 'react';
import { decompressSync, strFromU8 } from 'fflate';
import type { Root as HastRoot } from 'hast';
import { decode } from 'uint8-to-base64';
import type {
  VariantCode,
  VariantSource,
  Code,
  SourceEnhancers,
  SourceComments,
} from '../CodeHighlighter/types';
import { useUrlHashState } from '../useUrlHashState';
import { countLines } from '../pipeline/parseSource/addLineGutters';
import { getLanguageFromExtension } from '../pipeline/loaderUtils/getLanguageFromExtension';
import type { TransformedFiles } from './useCodeUtils';
import { Pre } from './Pre';
import { useSourceEnhancing } from './useSourceEnhancing';

/**
 * Gets the language from a filename by extracting its extension.
 * @param fileName - The filename (e.g., 'index.tsx', 'styles.css')
 * @returns The language name or undefined
 */
function getLanguageFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return undefined;
  }
  const extension = fileName.substring(lastDotIndex);
  return getLanguageFromExtension(extension);
}

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
 * All variants except "Default" include the variant name in the hash
 * @param mainSlug - The main component/demo slug
 * @param fileName - The file name
 * @param variantName - The variant name
 * @returns Generated file slug
 */
function generateFileSlug(mainSlug: string, fileName: string, variantName: string): string {
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

  // Format: mainSlug:fileName.ext (for Default variant) or mainSlug:variantName:fileName.ext
  // "Default" variant is treated specially and doesn't include variant name in hash
  if (variantName === 'Default') {
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
  preClassName?: string;
  preRef?: React.Ref<HTMLPreElement>;
  effectiveCode?: Code;
  selectVariant?: React.Dispatch<React.SetStateAction<string>>;
  fileHashMode?: 'remove-hash' | 'remove-filename';
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  saveVariantToLocalStorage?: (variant: string) => void;
  hashVariant?: string | null;
  /**
   * Array of enhancer functions to apply to parsed HAST sources.
   * Enhancers receive the HAST root, comments extracted from source, and filename.
   */
  sourceEnhancers?: SourceEnhancers;
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
  shouldHighlight,
  preClassName,
  preRef,
  effectiveCode,
  selectVariant,
  fileHashMode = 'remove-hash',
  saveHashVariantToLocalStorage = 'on-interaction',
  saveVariantToLocalStorage,
  hashVariant,
  sourceEnhancers,
}: UseFileNavigationProps): UseFileNavigationResult {
  // Keep selectedFileName as untransformed filename for internal tracking
  const [selectedFileNameInternal, setSelectedFileNameInternal] = React.useState<
    string | undefined
  >(selectedVariant?.fileName);

  // Use the simplified URL hash hook
  const [hash, setHash] = useUrlHashState();

  // Track if we're waiting for a variant switch to complete, and which file to select after
  const pendingFileSelection = React.useRef<string | null>(null);
  const justCompletedPendingSelection = React.useRef(false);

  // Track the previous variant key to detect user-initiated changes
  const prevVariantKeyRef = React.useRef(selectedVariantKey);
  const [prevVariantKeyState, setPrevVariantKeyState] = React.useState(selectedVariantKey);
  const isInitialMount = React.useRef(true);

  // Detect if the current variant change was driven by a hash change
  // A variant change is hash-driven if the hash has a variant that matches where we're going
  // AND we weren't already on that variant (i.e., the hash is what triggered the change)
  const [prevHashVariant, setPrevHashVariant] = React.useState<string | null>(hashVariant || null);
  const isHashDrivenVariantChange =
    hashVariant === selectedVariantKey && prevVariantKeyState !== selectedVariantKey;

  // Update prevHashVariant when hashVariant changes
  React.useEffect(() => {
    if (hashVariant !== prevHashVariant) {
      setPrevHashVariant(hashVariant || null);
    }
  }, [hashVariant, prevHashVariant]);

  // Update prevVariantKeyState when variant changes
  React.useEffect(() => {
    if (selectedVariantKey !== prevVariantKeyState) {
      setPrevVariantKeyState(selectedVariantKey);
    }
  }, [selectedVariantKey, prevVariantKeyState]);

  // Helper function to check URL hash and switch to matching file
  const checkUrlHashAndSelectFile = React.useCallback(() => {
    if (!hash) {
      return;
    }

    // Try to find matching file - check current variant first
    let matchingFileName: string | undefined;
    let matchingVariantKey: string | undefined;

    // Step 1: Check current variant (if we have one)
    if (selectedVariant) {
      // Check main file
      if (selectedVariant.fileName) {
        const mainFileSlug = generateFileSlug(
          mainSlug,
          selectedVariant.fileName,
          selectedVariantKey,
        );
        if (hash === mainFileSlug) {
          matchingFileName = selectedVariant.fileName;
          matchingVariantKey = selectedVariantKey;
        }
      }

      // Check extra files
      if (!matchingFileName && selectedVariant.extraFiles) {
        for (const fileName of Object.keys(selectedVariant.extraFiles)) {
          const fileSlug = generateFileSlug(mainSlug, fileName, selectedVariantKey);
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
          const fileSlug = generateFileSlug(mainSlug, file.originalName, selectedVariantKey);
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

        // Check main file
        if (variant.fileName) {
          const mainFileSlug = generateFileSlug(mainSlug, variant.fileName, variantKey);
          if (hash === mainFileSlug) {
            matchingFileName = variant.fileName;
            matchingVariantKey = variantKey;
            break;
          }
        }

        // Check extra files
        if (!matchingFileName && variant.extraFiles) {
          for (const fileName of Object.keys(variant.extraFiles)) {
            const fileSlug = generateFileSlug(mainSlug, fileName, variantKey);
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
      // If the matching file is in a different variant, switch to that variant first
      if (matchingVariantKey !== selectedVariantKey && selectVariant) {
        // Remember which file to select after variant switch
        pendingFileSelection.current = matchingFileName;
        selectVariant(matchingVariantKey);
        // Don't set the file here - it will be set after variant changes
        return;
      }

      // Set the file if we're in the correct variant
      pendingFileSelection.current = null;
      setSelectedFileNameInternal(matchingFileName);
    }
  }, [
    hash,
    selectedVariant,
    selectedVariantKey,
    mainSlug,
    transformedFiles,
    effectiveCode,
    selectVariant,
  ]);

  // Run hash check when URL hash changes to select the matching file
  React.useEffect(() => {
    checkUrlHashAndSelectFile();
  }, [checkUrlHashAndSelectFile]);

  // When variant switches with a pending file selection, complete the file selection
  React.useEffect(() => {
    if (pendingFileSelection.current && selectedVariant) {
      const fileToSelect = pendingFileSelection.current;
      pendingFileSelection.current = null;
      justCompletedPendingSelection.current = true;
      setSelectedFileNameInternal(fileToSelect);
    } else {
      justCompletedPendingSelection.current = false;
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
      }
    }
  }, [selectedVariant, selectedFileNameInternal]);

  // Update hash when variant changes (user-initiated variant switch)
  React.useEffect(() => {
    // Skip on initial mount - let hash-driven navigation handle it
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // Only update hash if there's already a relevant hash present
    if (typeof window === 'undefined' || !isHashRelevantToDemo(hash, mainSlug)) {
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // Skip if variant hasn't actually changed
    if (prevVariantKeyRef.current === selectedVariantKey) {
      return;
    }

    // Skip if this is a hash-driven variant change (hash is driving the variant selection)
    if (
      pendingFileSelection.current ||
      justCompletedPendingSelection.current ||
      isHashDrivenVariantChange
    ) {
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // User switched variants, update hash based on fileHashMode
    // Note: localStorage is already saved by setSelectedVariantKeyAsUser
    if (fileHashMode === 'remove-filename') {
      // Keep variant in hash: mainSlug or mainSlug:variant (for non-Default variants)
      const kebabMainSlug = toKebabCase(mainSlug);
      if (selectedVariantKey === 'Default') {
        setHash(kebabMainSlug);
      } else {
        const kebabVariantName = toKebabCase(selectedVariantKey);
        setHash(`${kebabMainSlug}:${kebabVariantName}`);
      }
    } else {
      // Remove entire hash
      setHash(null);
    }

    prevVariantKeyRef.current = selectedVariantKey;
  }, [selectedVariantKey, hash, mainSlug, fileHashMode, setHash, isHashDrivenVariantChange]);

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

  // Get comments for the selected file from the variant
  const selectedFileComments = React.useMemo((): SourceComments | undefined => {
    if (!selectedVariant) {
      return undefined;
    }

    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName) {
      return undefined;
    }

    // Check if it's the main file
    if (effectiveFileName === selectedVariant.fileName) {
      return selectedVariant.comments;
    }

    // Check extra files
    if (selectedVariant.extraFiles?.[effectiveFileName]) {
      const extraFile = selectedVariant.extraFiles[effectiveFileName];
      if (typeof extraFile === 'object' && 'comments' in extraFile) {
        return extraFile.comments;
      }
    }

    return undefined;
  }, [selectedVariant, selectedFileNameInternal]);

  // Apply source enhancers to the selected file
  const { enhancedSource } = useSourceEnhancing({
    source: selectedFile,
    fileName: selectedFileName,
    comments: selectedFileComments,
    sourceEnhancers,
  });

  const selectedFileComponent = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }

    // Determine the source to render:
    // - If enhancers are present, use enhanced source (falls back to selectedFile)
    // - Otherwise use selectedFile directly (which may be from transformed files)
    const sourceToRender =
      sourceEnhancers && sourceEnhancers.length > 0
        ? (enhancedSource ?? selectedFile)
        : selectedFile;

    if (sourceToRender != null) {
      // Determine language: use variant's language for main file, or derive from filename for extra files
      const isMainFile =
        !selectedFileNameInternal || selectedFileNameInternal === selectedVariant.fileName;
      const language = isMainFile
        ? selectedVariant.language
        : getLanguageFromFileName(selectedFileNameInternal);

      return (
        <Pre
          className={preClassName}
          language={language}
          ref={preRef}
          shouldHighlight={shouldHighlight}
        >
          {sourceToRender}
        </Pre>
      );
    }

    return null;
  }, [
    selectedVariant,
    shouldHighlight,
    preClassName,
    preRef,
    enhancedSource,
    selectedFile,
    sourceEnhancers,
    selectedFileNameInternal,
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

    // If we have transformed files, use them
    if (transformedFiles) {
      return transformedFiles.files.map((f) => ({
        name: f.name,
        slug: generateFileSlug(mainSlug, f.originalName, selectedVariantKey),
        component: (
          <Pre className={preClassName} ref={preRef} shouldHighlight={shouldHighlight}>
            {f.source}
          </Pre>
        ),
      }));
    }

    // Otherwise, create files from original untransformed data
    const result: Array<{ name: string; slug?: string; component: React.ReactNode }> = [];

    // Only add main file if it has a fileName
    if (selectedVariant.fileName && selectedVariant.source) {
      result.push({
        name: selectedVariant.fileName,
        slug: generateFileSlug(mainSlug, selectedVariant.fileName, selectedVariantKey),
        component: (
          <Pre
            className={preClassName}
            language={selectedVariant.language}
            ref={preRef}
            shouldHighlight={shouldHighlight}
          >
            {selectedVariant.source}
          </Pre>
        ),
      });
    }

    if (selectedVariant.extraFiles) {
      Object.entries(selectedVariant.extraFiles).forEach(([fileName, fileData]) => {
        let source: VariantSource | undefined;
        let language: string | undefined;

        if (typeof fileData === 'string') {
          source = fileData;
        } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
          source = fileData.source;
          language = fileData.language;
        } else {
          return; // Skip invalid entries
        }

        if (!source) {
          return; // Skip null/undefined sources
        }

        result.push({
          name: fileName,
          slug: generateFileSlug(mainSlug, fileName, selectedVariantKey),
          component: (
            <Pre
              className={preClassName}
              language={language ?? getLanguageFromFileName(fileName)}
              ref={preRef}
              shouldHighlight={shouldHighlight}
            >
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

      // If we have transformed files, we need to reverse-lookup the original filename
      if (transformedFiles) {
        // Check if the fileName is a transformed name - if so, find the original
        const fileByTransformedName = transformedFiles.files.find((f) => f.name === fileName);
        if (fileByTransformedName) {
          targetFileName = fileByTransformedName.originalName;
        } else {
          // Check if the fileName is already an original name
          const fileByOriginalName = transformedFiles.files.find(
            (f) => f.originalName === fileName,
          );
          if (fileByOriginalName) {
            targetFileName = fileName;
          }
        }
      }

      // Handle hash removal based on fileHashMode
      if (typeof window !== 'undefined' && isHashRelevantToDemo(hash, mainSlug)) {
        // Save variant to localStorage if on-interaction mode (clicking a tab counts as interaction)
        if (saveVariantToLocalStorage && saveHashVariantToLocalStorage === 'on-interaction') {
          saveVariantToLocalStorage(selectedVariantKey);
        }

        if (fileHashMode === 'remove-filename') {
          // Keep variant in hash: mainSlug or mainSlug:variant (for non-Default variants)
          const kebabMainSlug = toKebabCase(mainSlug);
          if (selectedVariantKey === 'Default') {
            setHash(kebabMainSlug);
          } else {
            const kebabVariantName = toKebabCase(selectedVariantKey);
            setHash(`${kebabMainSlug}:${kebabVariantName}`);
          }
        } else {
          // Remove entire hash
          setHash(null);
        }
      }

      setSelectedFileNameInternal(targetFileName);
    },
    [
      selectedVariant,
      transformedFiles,
      mainSlug,
      selectedVariantKey,
      fileHashMode,
      hash,
      setHash,
      saveHashVariantToLocalStorage,
      saveVariantToLocalStorage,
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

      // Add variant-only slug (points to main file of the variant)
      // Skip for Default variant since it doesn't have variant name in hash
      if (variant.fileName && variantKey !== 'Default') {
        const kebabMainSlug = toKebabCase(mainSlug);
        const kebabVariantName = toKebabCase(variantKey);
        const variantOnlySlug = `${kebabMainSlug}:${kebabVariantName}`;

        result.push({
          fileName: variant.fileName,
          slug: variantOnlySlug,
          variantName: variantKey,
        });
      }

      // Add main file if it exists
      if (variant.fileName) {
        result.push({
          fileName: variant.fileName,
          slug: generateFileSlug(mainSlug, variant.fileName, variantKey),
          variantName: variantKey,
        });
      }

      // Add extra files
      if (variant.extraFiles) {
        Object.keys(variant.extraFiles).forEach((fileName) => {
          result.push({
            fileName,
            slug: generateFileSlug(mainSlug, fileName, variantKey),
            variantName: variantKey,
          });
        });
      }
    }

    return result;
  }, [effectiveCode, variantKeys, mainSlug]);

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
