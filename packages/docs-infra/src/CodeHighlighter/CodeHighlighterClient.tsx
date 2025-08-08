'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps, ControlledCode, VariantCode } from './types';
import { CodeHighlighterContext, CodeHighlighterContextType } from './CodeHighlighterContext';
import { maybeInitialData } from './maybeInitialData';
import { loadFallbackCode } from './loadFallbackCode';
import { hasAllVariants } from './hasAllVariants';
import { loadVariant } from './loadVariant';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { Selection, useControlledCode } from '../CodeControllerContext';
import { codeToFallbackProps } from './codeToFallbackProps';
import { parseCode } from './parseCode';
import { applyTransforms, getAvailableTransforms } from './transformCode';
import { parseControlledCode } from './parseControlledCode';
import { useOnHydrate } from '../useOnHydrate';
import { useOnIdle } from '../useOnIdle';
import { mergeMetadata } from './mergeMetadata';

const DEBUG = false; // Set to true for debugging purposes

function useInitialData({
  variants,
  variantName,
  code,
  setCode,
  fileName,
  url,
  highlightAt,
  fallbackUsesExtraFiles,
  fallbackUsesAllVariants,
  isControlled,
  globalsCode,
  setProcessedGlobalsCode,
}: {
  variants: string[];
  variantName: string;
  code?: Code;
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
  fileName?: string;
  url?: string;
  highlightAt?: 'init' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  isControlled: boolean;
  globalsCode?: Array<Code | string>;
  setProcessedGlobalsCode: React.Dispatch<React.SetStateAction<Array<Code> | undefined>>;
}) {
  const { sourceParser, loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

  const { initialData, reason } = React.useMemo(
    () =>
      maybeInitialData(
        variants,
        variantName,
        code,
        fileName,
        highlightAt === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
      ),
    [
      variants,
      variantName,
      code,
      fileName,
      highlightAt,
      fallbackUsesExtraFiles,
      fallbackUsesAllVariants,
    ],
  );

  // TODO: fallbackInitialRenderOnly option? this would mean we can't fetch fallback data on the client side
  // Load initial data if not provided
  React.useEffect(() => {
    if (initialData || isControlled) {
      return;
    }

    if (!url) {
      // TODO: handle error - URL is required for loading fallback data
      return;
    }

    // TODO: abort controller

    (async () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('Loading initial data for CodeHighlighterClient: ', reason);
      }

      const loaded = await loadFallbackCode(
        url,
        variantName,
        code,
        highlightAt === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
        sourceParser,
        loadSource,
        loadVariantMeta,
        loadCodeMeta,
        fileName,
        variants,
        globalsCode, // Let loadFallbackCode handle processing
      ).catch((error) => ({ error }));

      if ('error' in loaded) {
        // TODO: handle error
      } else {
        setCode(loaded.code);
        // Store processed globalsCode from loadFallbackCode result
        if (loaded.processedGlobalsCode) {
          setProcessedGlobalsCode(loaded.processedGlobalsCode);
        }
      }
    })();
  }, [
    initialData,
    reason,
    isControlled,
    variantName,
    code,
    setCode,
    highlightAt,
    url,
    sourceParser,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    fileName,
    variants,
    globalsCode,
    setProcessedGlobalsCode,
  ]);
}

function useAllVariants({
  readyForContent,
  variants,
  isControlled,
  url,
  code,
  setCode,
  processedGlobalsCode,
  globalsCode,
  setProcessedGlobalsCode,
}: {
  readyForContent: boolean;
  variants: string[];
  isControlled: boolean;
  url?: string;
  code?: Code;
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
  processedGlobalsCode?: Array<Code>;
  globalsCode?: Array<Code | string>;
  setProcessedGlobalsCode: React.Dispatch<React.SetStateAction<Array<Code> | undefined>>;
}) {
  const { loadCodeMeta, loadVariantMeta, loadSource } = useCodeContext();

  React.useEffect(() => {
    if (readyForContent || isControlled) {
      return;
    }

    if (!url) {
      // URL is required for loading variants
      return;
    }

    // TODO: abort controller

    (async () => {
      let loadedCode = code;
      if (!loadedCode) {
        if (!loadCodeMeta) {
          throw new Error('"loadCodeMeta" function is required when no code is provided');
        }

        loadedCode = await loadCodeMeta(url);
      }

      // Use the already-processed globalsCode from state, or process it if not available
      let globalsCodeObjects: Array<Code> = [];
      if (processedGlobalsCode) {
        // Use the already-processed globalsCode from state
        globalsCodeObjects = processedGlobalsCode;
      } else if (globalsCode && globalsCode.length > 0) {
        // Process globalsCode: load any string URLs into Code objects
        globalsCodeObjects = await Promise.all(
          globalsCode.map(async (item) => {
            if (typeof item === 'string') {
              // Load Code object from URL string
              if (!loadCodeMeta) {
                throw new Error(
                  '"loadCodeMeta" function is required for string URLs in globalsCode',
                );
              }
              return loadCodeMeta(item);
            }
            // Already a Code object
            return item;
          }),
        );
        // Store processed globalsCode in state for future use
        setProcessedGlobalsCode(globalsCodeObjects);
      }

      // Load variant data without parsing or transforming
      const result = await Promise.all(
        variants.map((name) => {
          // Resolve globalsCode for this specific variant
          const globalsForVariant = globalsCodeObjects
            .map((codeObj: Code) => {
              // Only include if this variant exists in the globalsCode
              return codeObj[name];
            })
            .filter((item: any): item is VariantCode | string => Boolean(item));

          return loadVariant(
            url,
            name,
            loadedCode[name],
            undefined, // sourceParser - skip parsing
            loadSource,
            loadVariantMeta,
            undefined, // sourceTransformers - skip transforming
            {
              disableParsing: true,
              disableTransforms: true,
              globalsCode: globalsForVariant,
            },
          )
            .then((variant) => ({ name, variant }))
            .catch((error) => ({ error }));
        }),
      );

      const resultCode: Code = {};
      const errors: Error[] = [];
      for (const item of result) {
        if ('error' in item) {
          errors.push(item.error);
        } else {
          resultCode[item.name] = item.variant.code;
        }
      }

      if (errors.length > 0) {
        // TODO: handle error
      } else {
        setCode(resultCode);
      }
    })();
  }, [
    readyForContent,
    isControlled,
    variants,
    url,
    code,
    setCode,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    processedGlobalsCode,
    globalsCode,
    setProcessedGlobalsCode,
  ]);

  return { readyForContent };
}

function useCodeParsing({
  code,
  readyForContent,
  highlightAt,
}: {
  code?: Code;
  readyForContent: boolean;
  highlightAt?: 'init' | 'hydration' | 'idle';
}) {
  const { parseSource } = useCodeContext();

  // Use timing hooks to determine when to highlight
  const isHydrated = useOnHydrate();
  const isIdle = useOnIdle();

  // Determine if we should highlight based on the highlightAt setting
  const shouldHighlight = React.useMemo(() => {
    if (!readyForContent) {
      return false;
    }

    switch (highlightAt) {
      case 'hydration':
        return isHydrated;
      case 'idle':
        return isIdle;
      case 'init':
      default:
        return true;
    }
  }, [readyForContent, highlightAt, isHydrated, isIdle]);

  // Parse the internal code state when ready and timing conditions are met
  const parsedCode = React.useMemo(() => {
    if (!code || !shouldHighlight || !parseSource) {
      return undefined;
    }

    return parseCode(code, parseSource);
  }, [code, shouldHighlight, parseSource]);

  const deferHighlight = !shouldHighlight;

  return { parsedCode, deferHighlight };
}

function useCodeTransforms({
  parsedCode,
  variantName,
}: {
  parsedCode?: Code;
  variantName: string;
}) {
  const { sourceParser } = useCodeContext();
  const [transformedCode, setTransformedCode] = React.useState<Code | undefined>(undefined);

  // Get available transforms from the current variant (separate memo for efficiency)
  const availableTransforms = React.useMemo(() => {
    return getAvailableTransforms(parsedCode, variantName);
  }, [parsedCode, variantName]);

  // Effect to compute transformations for all variants
  React.useEffect(() => {
    if (!parsedCode || !sourceParser) {
      setTransformedCode(parsedCode);
      return;
    }

    // Process transformations for all variants
    (async () => {
      try {
        const parseSource = await sourceParser;
        const enhanced = await applyTransforms(parsedCode, parseSource);
        setTransformedCode(enhanced);
      } catch (error) {
        console.error('Failed to process transforms:', error);
        setTransformedCode(parsedCode);
      }
    })();
  }, [parsedCode, sourceParser]);

  return { transformedCode, availableTransforms };
}

function useControlledCodeParsing({ controlledCode }: { controlledCode?: ControlledCode }) {
  const { parseSource } = useCodeContext();

  // Parse the controlled code separately (no need to check readyForContent)
  const parsedControlledCode = React.useMemo(() => {
    if (!controlledCode || !parseSource) {
      return undefined;
    }

    return parseControlledCode(controlledCode, parseSource);
  }, [controlledCode, parseSource]);

  return { parsedControlledCode };
}

function useGlobalsCodeMerging({
  code,
  globalsCode,
  processedGlobalsCode,
  setProcessedGlobalsCode,
  readyForContent,
  variants,
}: {
  code?: Code;
  globalsCode?: Array<Code | string>;
  processedGlobalsCode?: Array<Code>;
  setProcessedGlobalsCode: React.Dispatch<React.SetStateAction<Array<Code> | undefined>>;
  readyForContent: boolean;
  variants: string[];
}) {
  const { loadCodeMeta, loadSource, loadVariantMeta } = useCodeContext();

  // Set processedGlobalsCode if we have ready Code objects but haven't stored them yet
  React.useEffect(() => {
    if (!globalsCode || processedGlobalsCode) {
      return; // No globals or already processed
    }

    // Check if all items are already Code objects (precomputed)
    if (globalsCode.every((item) => typeof item === 'object')) {
      const codeObjects = globalsCode as Array<Code>;
      // Check if all Code objects have all their own variants
      const allReady = codeObjects.every((codeObj) =>
        hasAllVariants(Object.keys(codeObj), codeObj),
      );
      if (allReady) {
        setProcessedGlobalsCode(codeObjects);
        return;
      }
      // If not all ready, fall through to loading logic below
    }

    // Need to load string URLs or load missing variants
    (async () => {
      try {
        // First, load any string URLs into Code objects
        const basicCodeObjects = await Promise.all(
          globalsCode.map(async (item) => {
            if (typeof item === 'string') {
              if (!loadCodeMeta) {
                throw new Error(
                  '"loadCodeMeta" function is required for string URLs in globalsCode',
                );
              }
              return { codeObj: await loadCodeMeta(item), originalUrl: item };
            }
            return { codeObj: item, originalUrl: undefined };
          }),
        );

        // Now check if we need to load variants for any of the Code objects
        const fullyLoadedCodeObjects = await Promise.all(
          basicCodeObjects.map(async ({ codeObj, originalUrl }) => {
            // Check if this Code object has all required variants
            if (hasAllVariants(variants, codeObj)) {
              return codeObj; // Already has all variants
            }

            // Need to load missing variants
            const loadedVariants: Code = { ...codeObj };

            await Promise.all(
              variants.map(async (variantName) => {
                if (codeObj[variantName] && typeof codeObj[variantName] === 'object') {
                  return; // Variant already loaded
                }

                // Need to load this variant
                try {
                  const result = await loadVariant(
                    originalUrl || '', // Use the original URL if available
                    variantName,
                    codeObj[variantName], // May be undefined or string
                    undefined, // sourceParser - skip parsing for now
                    loadSource,
                    loadVariantMeta,
                    undefined, // sourceTransformers - skip transforming
                    {
                      disableParsing: true,
                      disableTransforms: true,
                    },
                  );
                  loadedVariants[variantName] = result.code;
                } catch (error) {
                  console.warn(`Failed to load variant ${variantName} for globalsCode:`, error);
                  // Keep the original variant data (may be undefined)
                }
              }),
            );

            return loadedVariants;
          }),
        );

        setProcessedGlobalsCode(fullyLoadedCodeObjects);
      } catch (error) {
        console.warn('Failed to load globalsCode:', error);
      }
    })();
  }, [
    globalsCode,
    processedGlobalsCode,
    setProcessedGlobalsCode,
    loadCodeMeta,
    loadSource,
    loadVariantMeta,
    variants,
  ]);

  // Determine globalsCodeObjects to use (prefer processed, fallback to direct if ready)
  const globalsCodeObjects = React.useMemo(() => {
    if (processedGlobalsCode) {
      return processedGlobalsCode;
    }

    if (globalsCode && globalsCode.every((item) => typeof item === 'object')) {
      const codeObjects = globalsCode as Array<Code>;
      const allGlobalsReady = codeObjects.every((codeObj) =>
        hasAllVariants(Object.keys(codeObj), codeObj),
      );

      if (allGlobalsReady) {
        return codeObjects;
      }
    }

    return undefined;
  }, [processedGlobalsCode, globalsCode]);

  // Merge globalsCode with code when ready
  return React.useMemo(() => {
    // If no globalsCode or code not ready, return as-is
    if (!globalsCode || !code || !readyForContent) {
      return code;
    }

    // If globalsCodeObjects isn't ready yet, return unmerged code for now
    if (!globalsCodeObjects) {
      return code;
    }

    // For precomputed code, do simple synchronous merging of extraFiles
    const mergedCode: Code = { ...code };
    let hasChanges = false;

    variants.forEach((variant) => {
      const variantData = code[variant];
      if (!variantData || typeof variantData === 'string') {
        return;
      }

      // Get globalsCode for this variant (only exact matches, no fallback)
      const globalsForVariant = globalsCodeObjects
        .map((codeObj: Code) => codeObj[variant])
        .filter((item: any): item is VariantCode => Boolean(item) && typeof item === 'object');

      if (globalsForVariant.length > 0) {
        // Use mergeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeMetadata
            const globalsMetadata: Record<string, any> = {};

            for (const [key, value] of Object.entries(globalVariant.extraFiles)) {
              if (typeof value === 'string') {
                globalsMetadata[key] = { source: value };
              } else {
                globalsMetadata[key] = { ...value };
              }
            }

            // Use mergeMetadata to properly position and merge the globals
            currentVariant = mergeMetadata(currentVariant, globalsMetadata);
          }
        });

        // Only update if the variant actually changed
        if (currentVariant !== variantData) {
          mergedCode[variant] = currentVariant;
          hasChanges = true;
        }
      }
    });

    // Return merged code if we made changes, otherwise return original code
    return hasChanges ? mergedCode : code;
  }, [code, globalsCode, globalsCodeObjects, readyForContent, variants]);
}

function usePropsCodeGlobalsMerging({
  code,
  globalsCode,
  processedGlobalsCode,
  variants,
}: {
  code?: Code;
  globalsCode?: Array<Code | string>;
  processedGlobalsCode?: Array<Code>;
  variants: string[];
}) {
  // For props.code, always do synchronous merging if possible
  // We don't want to cache this in state since props.code can change frequently
  return React.useMemo(() => {
    if (!code || !globalsCode || !processedGlobalsCode) {
      return code; // No merge needed or not ready
    }

    // Use processedGlobalsCode for synchronous merging
    const globalsCodeObjects = processedGlobalsCode;

    // For props.code (controlled), do simple synchronous merging
    const mergedCode: Code = { ...code };
    let hasChanges = false;

    variants.forEach((variant) => {
      const variantData = code[variant];
      if (!variantData || typeof variantData === 'string') {
        return;
      }

      // Get globalsCode for this variant (only exact matches, no fallback)
      const globalsForVariant = globalsCodeObjects
        .map((codeObj: Code) => codeObj[variant])
        .filter((item: any): item is VariantCode => Boolean(item) && typeof item === 'object');

      if (globalsForVariant.length > 0) {
        // Use mergeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeMetadata
            const globalsMetadata: Record<string, any> = {};

            for (const [key, value] of Object.entries(globalVariant.extraFiles)) {
              if (typeof value === 'string') {
                globalsMetadata[key] = { source: value };
              } else {
                globalsMetadata[key] = { ...value };
              }
            }

            // Use mergeMetadata to properly position and merge the globals
            currentVariant = mergeMetadata(currentVariant, globalsMetadata);
          }
        });

        // Only update if the variant actually changed
        if (currentVariant !== variantData) {
          mergedCode[variant] = currentVariant;
          hasChanges = true;
        }
      }
    });

    // Return merged code if we made changes, otherwise return original code
    return hasChanges ? mergedCode : code;
  }, [code, globalsCode, processedGlobalsCode, variants]);
}

export function CodeHighlighterClient(props: CodeHighlighterClientProps) {
  const {
    controlledCode,
    controlledSelection,
    controlledSetCode,
    controlledSetSelection,
    controlledComponents,
  } = useControlledCode();

  const isControlled = Boolean(props.code || controlledCode);

  // TODO: props.code is for controlled components, props.precompute is for precomputed code
  // props.code should only be highlighted, but no additional fetching should be done
  // this is the case with live demos where the code can be edited by the user
  // then maybe props.code shouldn't allow highlighted code, only strings?
  // this is a code highlighter afterall, why would they want to control the highlighting aspect?

  // TODO: should we empty this state if controlled?
  const [code, setCode] = React.useState(
    typeof props.precompute === 'object' ? props.precompute : undefined,
  );

  // State to store processed globalsCode to avoid duplicate loading
  const [processedGlobalsCode, setProcessedGlobalsCode] = React.useState<Array<Code> | undefined>(
    undefined,
  );

  // TODO: if using props.variant, then the variant is controlled and we can't use our own state
  // does props.variant make any sense instead of controlledSelection?.variant?
  const [selection, setSelection] = React.useState<Selection>({
    variant: props.initialVariant || props.defaultVariant || 'Default',
  });

  const variantName = controlledSelection?.variant || props.variant || selection.variant;
  const activeCode = controlledCode || props.code || code;
  let initialFilename: string | undefined;
  if (typeof activeCode?.[variantName] === 'object') {
    const variant = activeCode[variantName];
    initialFilename = variant?.filesOrder ? variant.filesOrder[0] : variant?.fileName;
  }
  const fileName = controlledSelection?.fileName || props.fileName || initialFilename;

  const variants = props.variants || Object.keys(props.components || activeCode || {});
  const { url, highlightAt, fallbackUsesExtraFiles, fallbackUsesAllVariants } = props;

  useInitialData({
    variants,
    variantName,
    code,
    setCode,
    fileName,
    url,
    highlightAt,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    isControlled,
    globalsCode: props.globalsCode,
    setProcessedGlobalsCode,
  });

  const readyForContent = React.useMemo(() => {
    if (!code) {
      return false;
    }

    return hasAllVariants(variants, code);
  }, [code, variants]);

  // Separate check for activeCode to determine when to show fallback
  const activeCodeReady = React.useMemo(() => {
    if (!activeCode) {
      return false;
    }

    // Controlled code is always ready since it comes from editing already-ready code
    if (controlledCode) {
      return true;
    }

    // For regular code, use the existing hasAllVariants function
    const regularCode = props.code || code;
    return regularCode ? hasAllVariants(variants, regularCode) : false;
  }, [activeCode, controlledCode, variants, props.code, code]);

  useAllVariants({
    readyForContent,
    variants,
    isControlled,
    url,
    code,
    setCode,
    processedGlobalsCode,
    globalsCode: props.globalsCode,
    setProcessedGlobalsCode,
  });

  // Merge globalsCode with internal state code (fetched data) - this should be stable once ready
  const stateCodeWithGlobals = useGlobalsCodeMerging({
    code, // Only use internal state, not props.code
    globalsCode: props.globalsCode,
    processedGlobalsCode,
    setProcessedGlobalsCode,
    readyForContent,
    variants,
  });

  // For props.code (controlled), always re-merge when it changes (don't cache in state)
  const propsCodeWithGlobals = usePropsCodeGlobalsMerging({
    code: props.code,
    globalsCode: props.globalsCode,
    processedGlobalsCode,
    variants,
  });

  // Use props.code result if available, otherwise use state code result
  const codeWithGlobals = propsCodeWithGlobals || stateCodeWithGlobals;

  const { parsedCode, deferHighlight } = useCodeParsing({
    code: codeWithGlobals,
    readyForContent: readyForContent || Boolean(props.code),
    highlightAt,
  });

  const { transformedCode, availableTransforms } = useCodeTransforms({
    parsedCode,
    variantName,
  });

  const { parsedControlledCode } = useControlledCodeParsing({
    controlledCode,
  });

  // Determine the final overlaid code (controlled takes precedence)
  const overlaidCode = parsedControlledCode || transformedCode || codeWithGlobals;

  // For fallback context, use the processed code or fall back to non-controlled code
  const codeForFallback = overlaidCode || (controlledCode ? undefined : props.code || code);

  const fallbackContext = React.useMemo(
    () =>
      codeToFallbackProps(
        variantName,
        codeForFallback,
        fileName,
        props.fallbackUsesExtraFiles,
        props.fallbackUsesAllVariants,
      ),
    [
      variantName,
      codeForFallback,
      fileName,
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
    ],
  );

  const context: CodeHighlighterContextType = React.useMemo(
    () => ({
      code: overlaidCode, // Use processed/transformed code
      setCode: controlledSetCode,
      selection: controlledSelection || selection,
      setSelection: controlledSetSelection || setSelection,
      components: controlledComponents || props.components,
      availableTransforms: isControlled ? [] : availableTransforms,
      url: props.url,
      deferHighlight,
    }),
    [
      overlaidCode,
      controlledSetCode,
      selection,
      controlledSelection,
      controlledSetSelection,
      controlledComponents,
      props.components,
      isControlled,
      availableTransforms,
      props.url,
      deferHighlight,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Error(
      'CodeHighlighterClient requires either `variants`, `components`, or `code` to be provided.',
    );
  }

  const fallback = props.fallback;
  if (fallback && !props.skipFallback && !activeCodeReady) {
    return (
      <CodeHighlighterFallbackContext.Provider value={fallbackContext}>
        {fallback}
      </CodeHighlighterFallbackContext.Provider>
    );
  }

  return (
    <CodeHighlighterContext.Provider value={context}>
      {props.children}
    </CodeHighlighterContext.Provider>
  );
}
