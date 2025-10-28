import * as React from 'react';
import { decompressSync, strFromU8 } from 'fflate';
import type { Root as HastRoot } from 'hast';
import { decode } from 'uint8-to-base64';
import type { VariantCode, VariantSource, Code } from '../CodeHighlighter/types';
import { countLines } from '../pipeline/parseSource/addLineGutters';
import type { TransformedFiles } from './useCodeUtils';
import { Pre } from './Pre';
import { useFileHashNavigation } from './useFileHashNavigation';

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
export function generateFileSlug(
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

  // Delegate hash navigation to the specialized hook
  const { selectFileName } = useFileHashNavigation({
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
  });

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
