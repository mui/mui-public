import * as React from 'react';
import { stringOrHastToJsx, stringOrHastToString } from '../hastUtils';

import { useCopier, UseCopierOpts } from '../useCopier';
import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import type { ContentProps, ControlledCode, VariantSource } from '../CodeHighlighter/types';
import { applyTransform } from '../CodeHighlighter/applyTransform';

type Source = VariantSource;

type UseCodeOpts = {
  defaultOpen?: boolean;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  codeSandboxUrlPrefix?: string;
  stackBlitzPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
};

export interface UseCodeResult {
  component: React.ReactNode;
  ref: React.RefObject<HTMLDivElement | null>;
  variants: string[];
  selectedVariant: string;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
  files: Array<{ name: string; component: React.ReactNode }>;
  selectedFile: React.ReactNode;
  selectedFileName: string | undefined;
  selectFileName: (fileName: string) => void;
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  resetFocus: () => void;
  copy: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  availableTransforms: string[];
  selectedTransform: string | null | undefined;
  selectTransform: (transformName: string | null) => void;
  setSource?: (source: string) => void;
}

export function useCode<T extends {} = {}>(
  contentProps: ContentProps<T>,
  opts?: UseCodeOpts,
): UseCodeResult {
  const { copy: copyOpts, defaultOpen = false, initialVariant, initialTransform } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();

  const [expanded, setExpanded] = React.useState(defaultOpen);
  const expand = React.useCallback(() => setExpanded(true), []);

  const ref = React.useRef<HTMLDivElement>(null);
  const resetFocus = React.useCallback(() => {
    ref.current?.focus();
  }, []);

  // Get the effective code - context overrides contentProps if available
  const effectiveCode = React.useMemo(() => {
    return context?.code || contentProps.code || {};
  }, [context?.code, contentProps.code]);

  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  const [selectedVariantKey, setSelectedVariantKey] = React.useState<string>(
    initialVariant || variantKeys[0] || '',
  );

  const selectedVariant = React.useMemo(() => {
    const variant = effectiveCode[selectedVariantKey];
    if (variant && typeof variant === 'object' && 'source' in variant) {
      return variant;
    }
    return null;
  }, [effectiveCode, selectedVariantKey]);

  // Safety check: if selectedVariant doesn't exist, fall back to first variant
  React.useEffect(() => {
    if (!selectedVariant && variantKeys.length > 0) {
      setSelectedVariantKey(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys]);

  // Transform state - get available transforms from context or from the effective code data
  const availableTransforms = React.useMemo(() => {
    // First try to get from context
    if (context?.availableTransforms && context.availableTransforms.length > 0) {
      return context.availableTransforms;
    }

    // Otherwise, get from the effective code data
    const transforms = new Set<string>();
    if (effectiveCode && selectedVariantKey) {
      const variantCode = effectiveCode[selectedVariantKey];
      if (
        variantCode &&
        typeof variantCode === 'object' &&
        'transforms' in variantCode &&
        variantCode.transforms
      ) {
        Object.keys(variantCode.transforms).forEach((transformKey) => {
          transforms.add(transformKey);
        });
      }
    }

    return Array.from(transforms);
  }, [context?.availableTransforms, effectiveCode, selectedVariantKey]);

  const [selectedTransform, setSelectedTransform] = React.useState<string | null>(
    initialTransform || null,
  );

  // Memoize all transformed files based on selectedTransform
  const transformedFiles = React.useMemo(() => {
    // Only create transformed files when there's actually a transform selected
    if (!selectedVariant || !selectedTransform) {
      return undefined;
    }

    const files: Array<{
      name: string;
      originalName: string;
      source: Source;
      component: React.ReactNode;
    }> = [];
    const filenameMap: { [originalName: string]: string } = {};

    // Helper function to apply transform to a source
    const applyTransformToSource = (source: any, fileName: string, transforms: any) => {
      if (!transforms?.[selectedTransform]) {
        return { transformedSource: source, transformedName: fileName };
      }

      try {
        // Get transform data
        const transformData = transforms[selectedTransform];
        if (!transformData || typeof transformData !== 'object' || !('delta' in transformData)) {
          return { transformedSource: source, transformedName: fileName };
        }

        // Apply transform
        const result = applyTransform(source as Source, transforms, selectedTransform);
        const transformedName = transformData.fileName || fileName;

        return { transformedSource: result, transformedName };
      } catch (error) {
        console.error(`Transform failed for ${fileName}:`, error);
        return { transformedSource: source, transformedName: fileName };
      }
    };

    // Process main file - get transforms from selectedVariant
    const variantTransforms =
      'transforms' in selectedVariant ? selectedVariant.transforms : undefined;

    // Only process main file if we have a fileName
    if (!selectedVariant.fileName) {
      // If no fileName, we can't create meaningful file entries, return empty
      return { files: [], filenameMap: {} };
    }

    const { transformedSource: mainSource, transformedName: mainName } = applyTransformToSource(
      selectedVariant.source,
      selectedVariant.fileName,
      variantTransforms,
    );

    const fileName = selectedVariant.fileName;
    filenameMap[fileName] = mainName;
    files.push({
      name: mainName,
      originalName: fileName,
      source: mainSource as Source,
      component: stringOrHastToJsx(mainSource as Source, true),
    });

    // Process extra files
    if (selectedVariant.extraFiles) {
      Object.entries(selectedVariant.extraFiles).forEach(([extraFileName, fileData]) => {
        let source: any;
        let transforms: any;

        // Handle different extraFile structures
        if (typeof fileData === 'string') {
          source = fileData;
          transforms = undefined; // Don't inherit variant transforms for simple string files
        } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
          source = fileData.source;
          transforms = fileData.transforms; // Only use explicit transforms for this file
        } else {
          return; // Skip invalid entries
        }

        // Apply transforms if available
        let transformedSource = source;
        let transformedName = extraFileName;

        if (transforms?.[selectedTransform]) {
          try {
            const transformData = transforms[selectedTransform];
            if (transformData && typeof transformData === 'object' && 'delta' in transformData) {
              transformedSource = applyTransform(source as Source, transforms, selectedTransform);
              transformedName = transformData.fileName || extraFileName;
            }
          } catch (error) {
            console.error(`Transform failed for ${extraFileName}:`, error);
          }
        }

        // Only update filenameMap and add to files if this doesn't conflict with existing files
        // If a file already exists with the target name, skip this transformation to preserve original files
        const existingFile = files.find((f) => f.name === transformedName);
        if (!existingFile) {
          filenameMap[extraFileName] = transformedName;
          files.push({
            name: transformedName,
            originalName: extraFileName,
            source: transformedSource as Source,
            component: stringOrHastToJsx(transformedSource as Source, true),
          });
        } else {
          // If there's a conflict, keep the original file untransformed
          console.warn(
            `Transform conflict: ${extraFileName} would transform to ${transformedName} but that name is already taken. Keeping original file untransformed.`,
          );
          filenameMap[extraFileName] = extraFileName;
          files.push({
            name: extraFileName,
            originalName: extraFileName,
            source: source as Source,
            component: stringOrHastToJsx(source as Source, true),
          });
        }
      });
    }

    return { files, filenameMap };
  }, [selectedVariant, selectedTransform]);

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

  const sourceFileToText = React.useCallback((): string | undefined => {
    if (!selectedFile) {
      return undefined;
    }

    if (typeof selectedFile === 'string') {
      return selectedFile;
    }

    if (selectedFile && typeof selectedFile === 'object' && 'hastJson' in selectedFile) {
      return (selectedFile as { hastJson: string }).hastJson;
    }

    return stringOrHastToString(selectedFile);
  }, [selectedFile]);

  const { copy } = useCopier(sourceFileToText, copyOpts);

  // Function to switch to a specific transform
  const selectTransform = React.useCallback(
    (transformName: string | null) => {
      if (!transformName || availableTransforms.includes(transformName)) {
        setSelectedTransform(transformName);
      } else {
        setSelectedTransform(null);
      }
    },
    [availableTransforms],
  );

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

  const contextSetCode = context?.setCode;
  const setSource = React.useCallback(
    (source: string) => {
      if (contextSetCode) {
        contextSetCode((currentCode) => {
          let newCode: ControlledCode = {};
          if (!currentCode) {
            newCode = { ...effectiveCode } as ControlledCode; // TODO: ensure all source are strings
          }

          newCode[selectedVariantKey] = {
            ...(newCode[selectedVariantKey] || selectedVariant),
            source,
            extraFiles: {},
          } as ControlledCode[string];

          return newCode;
        });
      } else {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
      }
    },
    [contextSetCode, selectedVariantKey, effectiveCode, selectedVariant],
  );

  // Get the effective components object - context overrides contentProps
  // Components are kept separate from variant data to maintain clean separation of concerns
  const effectiveComponents = React.useMemo(() => {
    return context?.components || contentProps.components || {};
  }, [context?.components, contentProps.components]);

  return {
    component: effectiveComponents[selectedVariantKey] || null,
    ref,
    variants: variantKeys,
    selectedVariant: selectedVariantKey,
    selectVariant: setSelectedVariantKey,
    files,
    selectedFile: selectedFileComponent,
    selectedFileName,
    selectFileName,
    expanded,
    expand,
    setExpanded,
    resetFocus,
    copy,
    availableTransforms,
    selectedTransform,
    selectTransform,
    setSource,
  };
}
