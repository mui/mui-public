import * as React from 'react';
import { stringOrHastToJsx } from '../hastUtils';
import type { VariantSource } from '../CodeHighlighter/types';

type Source = VariantSource;

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
}

export interface UseFileNavigationResult {
  selectedFileName: string | undefined;
  selectedFile: any;
  selectedFileComponent: React.ReactNode;
  files: Array<{ name: string; component: React.ReactNode }>;
  selectFileName: (fileName: string) => void;
}

/**
 * Hook for managing file selection and navigation within a code variant
 */
export function useFileNavigation({
  selectedVariant,
  transformedFiles,
}: UseFileNavigationProps): UseFileNavigationResult {
  // Keep selectedFileName as untransformed filename for internal tracking
  const [selectedFileNameInternal, setSelectedFileNameInternal] = React.useState<
    string | undefined
  >(selectedVariant?.fileName);

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
      return selectedVariant.source;
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
        return extraFile.source;
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
      return stringOrHastToJsx(selectedVariant.source as Source, true);
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

      return stringOrHastToJsx(source as Source, true);
    }

    return null;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  // Convert files for the return interface
  const files = React.useMemo(() => {
    if (!selectedVariant) {
      return [];
    }

    // If we have transformed files, use them
    if (transformedFiles) {
      return transformedFiles.files.map((f) => ({
        name: f.name,
        component: f.component,
      }));
    }

    // Otherwise, create files from original untransformed data
    const result: Array<{ name: string; component: React.ReactNode }> = [];

    // Only add main file if it has a fileName
    if (selectedVariant.fileName) {
      result.push({
        name: selectedVariant.fileName,
        component: stringOrHastToJsx(selectedVariant.source as Source, true),
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

        result.push({
          name: fileName,
          component: stringOrHastToJsx(source as Source, true),
        });
      });
    }

    return result;
  }, [selectedVariant, transformedFiles]);

  // Create a wrapper for selectFileName that handles transformed filenames
  const selectFileName = React.useCallback(
    (fileName: string) => {
      if (!selectedVariant) {
        return;
      }

      // If we have transformed files, we need to reverse-lookup the original filename
      if (transformedFiles) {
        // Check if the fileName is a transformed name - if so, find the original
        const fileByTransformedName = transformedFiles.files.find((f) => f.name === fileName);
        if (fileByTransformedName) {
          setSelectedFileNameInternal(fileByTransformedName.originalName);
          return;
        }

        // Check if the fileName is already an original name
        const fileByOriginalName = transformedFiles.files.find((f) => f.originalName === fileName);
        if (fileByOriginalName) {
          setSelectedFileNameInternal(fileName);
          return;
        }
      }

      // If no transformed files or fileName not found, set directly (fallback for untransformed mode)
      setSelectedFileNameInternal(fileName);
    },
    [selectedVariant, transformedFiles],
  );

  return {
    selectedFileName,
    selectedFile,
    selectedFileComponent,
    files,
    selectFileName,
  };
}
