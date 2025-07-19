import * as React from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Nodes } from 'hast';
import { toText } from 'hast-util-to-text';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

import { useCopier, UseCopierOpts } from '../useCopier';
import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import { ContentProps } from '../CodeHighlighter/types';
import { applyTransform } from '../CodeHighlighter/applyTransform';
import { stringOrHastToJsx, stringOrHastToString } from '../hast/hast';

type Source = Nodes;
export type Variant = {
  component: React.ReactNode;
  fileName: string;
  source: Source;
  extraSource?: { [key: string]: Source };
};

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
  selectedFileName: string;
  selectFileName: React.Dispatch<React.SetStateAction<string>>;
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  resetFocus: () => void;
  copy: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  copyDisabled: boolean;
  availableTransforms: string[];
  selectedTransform: string | null | undefined;
  selectTransform: (transformName: string | null) => void;
}

function toComponent(source: Source) {
  return toJsxRuntime(source, { Fragment, jsx, jsxs });
}

export function useCode(contentProps: ContentProps, opts?: UseCodeOpts): UseCodeResult {
  const { copy: copyOpts, defaultOpen = false, initialVariant, initialTransform } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();

  const [expanded, setExpanded] = React.useState(defaultOpen);
  const expand = React.useCallback(() => setExpanded(true), []);

  const ref = React.useRef<HTMLDivElement>(null);
  const resetFocus = React.useCallback(() => {
    ref.current?.focus();
  }, []);

  // Convert ContentProps to internal variant format
  const codeData = React.useMemo(() => {
    const variants: { [key: string]: Variant } = {};

    if (contentProps.code) {
      Object.entries(contentProps.code).forEach(([variantKey, variantValue]) => {
        if (variantValue && typeof variantValue === 'object' && 'source' in variantValue) {
          // This is a VariantCode
          variants[variantKey] = {
            component: contentProps.components?.[variantKey] || null,
            fileName: variantValue.fileName,
            source: variantValue.source as any, // Type assertion needed here
            extraSource: variantValue.extraFiles as any, // Type assertion needed here
          };
        }
      });
    }

    return { variants };
  }, [contentProps.code, contentProps.components]);

  // If context provides code, it should override the passed contentProps
  const effectiveCodeData = React.useMemo(() => {
    if (context?.code) {
      // Convert context code to CodeData format
      const contextVariants: { [key: string]: Variant } = {};

      Object.entries(context.code).forEach(([variantKey, variantValue]) => {
        if (variantValue && typeof variantValue === 'object' && 'source' in variantValue) {
          // This is a VariantCode
          contextVariants[variantKey] = {
            component: context.components?.[variantKey] || null,
            fileName: variantValue.fileName,
            source: variantValue.source as any, // Type assertion needed here
            extraSource: variantValue.extraFiles as any, // Type assertion needed here
          };
        }
      });

      return Object.keys(contextVariants).length > 0 ? { variants: contextVariants } : codeData;
    }
    return codeData;
  }, [context?.code, context?.components, codeData]);

  const variantKeys = React.useMemo(
    () => Object.keys(effectiveCodeData.variants),
    [effectiveCodeData.variants],
  );

  // Use context to override initial variant if available
  const effectiveInitialVariant = initialVariant || variantKeys[0];
  const [selectedVariantKey, setSelectedVariantKey] =
    React.useState<string>(effectiveInitialVariant);
  const selectedVariant = effectiveCodeData.variants[selectedVariantKey];

  // Safety check: if selectedVariant doesn't exist, fall back to first variant
  React.useEffect(() => {
    if (!selectedVariant && variantKeys.length > 0) {
      setSelectedVariantKey(variantKeys[0]);
    }
  }, [selectedVariant, variantKeys]);

  // Transform state - get available transforms from context or from the code data
  const availableTransforms = React.useMemo(() => {
    // First try to get from context
    if (context?.availableTransforms && context.availableTransforms.length > 0) {
      return context.availableTransforms;
    }

    // Otherwise, get from the effective code data
    const transforms = new Set<string>();
    if (contentProps.code && selectedVariantKey) {
      const variantCode = contentProps.code[selectedVariantKey];
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
  }, [context?.availableTransforms, contentProps.code, selectedVariantKey]);

  // Use context transform state if available, otherwise local state
  const contextHasTransformState =
    context?.selectedTransform !== undefined || context?.setSelectedTransform !== undefined;
  const [localSelectedTransform, setLocalSelectedTransform] = React.useState<string | null>(
    initialTransform || null, // Don't default to first available transform
  );

  const selectedTransform = contextHasTransformState
    ? context?.selectedTransform
    : localSelectedTransform;
  const setSelectedTransformState = contextHasTransformState
    ? context?.setSelectedTransform
    : setLocalSelectedTransform;

  const [selectedFileName, setSelectedFileName] = React.useState(selectedVariant?.fileName || '');

  // Update selectedFileName when transforms change the file names
  React.useEffect(() => {
    if (!selectedVariant) {
      return;
    }

    // Get the transformed name for the current selection
    const getTransformedFileName = (originalFileName: string) => {
      // If no transform is selected, use original name
      if (!selectedTransform) {
        return originalFileName;
      }

      // Get the variant code to check for transforms
      if (contentProps.code && selectedVariantKey) {
        const variantCode = contentProps.code[selectedVariantKey];
        if (
          variantCode &&
          typeof variantCode === 'object' &&
          'transforms' in variantCode &&
          variantCode.transforms
        ) {
          // Check main variant transforms
          if (originalFileName === selectedVariant?.fileName) {
            const transform = variantCode.transforms[selectedTransform];
            if (transform?.fileName) {
              return transform.fileName;
            }
          }

          // Check extraFile transforms
          if (variantCode.extraFiles && variantCode.extraFiles[originalFileName]) {
            const extraFileData = variantCode.extraFiles[originalFileName];
            if (
              extraFileData &&
              typeof extraFileData === 'object' &&
              'transforms' in extraFileData &&
              extraFileData.transforms
            ) {
              const extraTransform = extraFileData.transforms[selectedTransform];
              if (extraTransform?.fileName) {
                return extraTransform.fileName;
              }
            }
          }
        }
      }

      return originalFileName;
    };

    // If the current selectedFileName doesn't match any available files,
    // default to the main file's (possibly transformed) name
    const transformedMainFileName = getTransformedFileName(selectedVariant.fileName);
    if (
      selectedFileName !== transformedMainFileName &&
      !selectedVariant.extraSource?.[selectedFileName]
    ) {
      setSelectedFileName(transformedMainFileName);
    }
  }, [selectedTransform, selectedVariant, selectedVariantKey, contentProps.code, selectedFileName]);

  const selectedFile = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }
    return selectedFileName === selectedVariant.fileName
      ? selectedVariant.source
      : selectedVariant.extraSource?.[selectedFileName];
  }, [selectedFileName, selectedVariant]);

  // Apply transform to sources when a transform is selected
  const getTransformedSource = React.useCallback(
    (source: Source, fileName: string) => {
      if (!selectedTransform) {
        return null;
      }

      // Get the variant code to access transforms
      if (contentProps.code && selectedVariantKey) {
        const variantCode = contentProps.code[selectedVariantKey];
        if (
          variantCode &&
          typeof variantCode === 'object' &&
          'transforms' in variantCode &&
          variantCode.transforms
        ) {
          try {
            // For the main file, apply the transform directly
            if (fileName === selectedVariant?.fileName) {
              if (variantCode.transforms[selectedTransform]) {
                // Additional validation: check if the transform has the required structure
                const transformData = variantCode.transforms[selectedTransform];
                if (
                  transformData &&
                  typeof transformData === 'object' &&
                  'delta' in transformData
                ) {
                  try {
                    // applyTransform now handles both string and Hast node sources properly
                    const result = applyTransform(
                      source,
                      variantCode.transforms,
                      selectedTransform,
                    );
                    return result;
                  } catch (transformError) {
                    console.error(`Transform failed for main file ${fileName}:`, transformError);
                    return null;
                  }
                }
              }
            } else if (variantCode.extraFiles && variantCode.extraFiles[fileName]) {
              // For extra files, handle the different data structures
              const extraFileData = variantCode.extraFiles[fileName];
              let extraFileSource: any;
              let extraFileTransforms: any;

              // extraFiles can have different structures
              if (typeof extraFileData === 'string') {
                extraFileSource = extraFileData;
                extraFileTransforms = variantCode.transforms;
              } else if (
                extraFileData &&
                typeof extraFileData === 'object' &&
                'source' in extraFileData
              ) {
                // Pass the raw source directly to applyTransform - it will handle format detection
                extraFileSource = extraFileData.source;
                extraFileTransforms = extraFileData.transforms || variantCode.transforms;
              }

              // Only apply transform if we have both source and transforms with the selected transform
              if (
                extraFileSource &&
                extraFileTransforms &&
                extraFileTransforms[selectedTransform]
              ) {
                // Additional validation: check if the transform has the required structure
                const transformData = extraFileTransforms[selectedTransform];
                if (
                  transformData &&
                  typeof transformData === 'object' &&
                  'delta' in transformData
                ) {
                  try {
                    // applyTransform now handles both string and Hast node sources properly
                    const result = applyTransform(
                      extraFileSource,
                      extraFileTransforms,
                      selectedTransform,
                    );
                    return result;
                  } catch (transformError) {
                    console.error(`Transform failed for ${fileName}:`, transformError);
                    return null;
                  }
                }
              }
            }
          } catch (error) {
            console.warn('Failed to apply transform to', fileName, ':', error);
            return null;
          }
        }
      }

      return null;
    },
    [selectedTransform, contentProps.code, selectedVariantKey, selectedVariant],
  ); // if copying, convert the selected file's hast to text
  const sourceFileToText = React.useCallback(() => {
    if (!selectedFile) {
      return undefined;
    }

    // First try to get transformed source
    const transformedSource = getTransformedSource(selectedFile, selectedFileName);
    if (transformedSource) {
      // Use the hast utility to convert any source type to string
      return stringOrHastToString(transformedSource);
    }

    // Fall back to original source
    if (typeof selectedFile === 'string') {
      return selectedFile;
    }

    return toText(selectedFile, { whitespace: 'pre' });
  }, [selectedFile, selectedFileName, getTransformedSource]);
  const { copy, disabled: copyDisabled } = useCopier(sourceFileToText, copyOpts);

  // transform hast source to React components
  const files = React.useMemo(() => {
    if (!selectedVariant) {
      return [];
    }

    const getTransformedFileName = (originalFileName: string) => {
      // If no transform is selected, use original name
      if (!selectedTransform) {
        return originalFileName;
      }

      // Get the variant code to check for transforms
      if (contentProps.code && selectedVariantKey) {
        const variantCode = contentProps.code[selectedVariantKey];
        if (
          variantCode &&
          typeof variantCode === 'object' &&
          'transforms' in variantCode &&
          variantCode.transforms
        ) {
          // Check main variant transforms
          if (originalFileName === selectedVariant?.fileName) {
            const transform = variantCode.transforms[selectedTransform];
            if (transform?.fileName) {
              return transform.fileName;
            }
          }

          // Check extraFile transforms
          if (variantCode.extraFiles && variantCode.extraFiles[originalFileName]) {
            const extraFileData = variantCode.extraFiles[originalFileName];
            if (
              extraFileData &&
              typeof extraFileData === 'object' &&
              'transforms' in extraFileData &&
              extraFileData.transforms
            ) {
              const extraTransform = extraFileData.transforms[selectedTransform];
              if (extraTransform?.fileName) {
                return extraTransform.fileName;
              }
            }
          }
        }
      }

      return originalFileName;
    };

    const processSource = (source: Source, fileName: string) => {
      // First try to get transformed source
      const transformedSource = getTransformedSource(source, fileName);
      if (transformedSource) {
        // Handle different types of transformed source
        if (typeof transformedSource === 'string') {
          // If it's a string, we need to render it as text (no syntax highlighting)
          return transformedSource;
        }
        // If it's Hast nodes, render with syntax highlighting
        return stringOrHastToJsx(transformedSource);
      }

      // Fall back to original source
      return toComponent(source);
    };

    const extraSource = selectedVariant.extraSource;
    return [
      {
        name: getTransformedFileName(selectedVariant.fileName),
        component: processSource(selectedVariant.source, selectedVariant.fileName),
      },
      ...(extraSource
        ? Object.keys(extraSource).map((name) => ({
            name: getTransformedFileName(name),
            component: processSource(extraSource[name], name),
          }))
        : []),
    ];
  }, [
    selectedVariant,
    getTransformedSource,
    selectedTransform,
    contentProps.code,
    selectedVariantKey,
  ]);

  const selectedFileComponent = React.useMemo(() => {
    const matchedFile = files.find((file) => file.name === selectedFileName);
    return matchedFile ? matchedFile.component : null;
  }, [files, selectedFileName]);

  // Function to switch to a specific transform
  const selectTransform = React.useCallback(
    (transformName: string | null) => {
      if (!transformName || availableTransforms.includes(transformName)) {
        setSelectedTransformState?.(transformName);
      }
    },
    [availableTransforms, setSelectedTransformState],
  );

  return {
    component: selectedVariant.component,
    ref,
    variants: variantKeys,
    selectedVariant: selectedVariantKey,
    selectVariant: setSelectedVariantKey,
    files,
    selectedFile: selectedFileComponent,
    selectedFileName,
    selectFileName: setSelectedFileName,
    expanded,
    expand,
    setExpanded,
    resetFocus,
    copy,
    copyDisabled,
    availableTransforms,
    selectedTransform,
    selectTransform,
  };
}
