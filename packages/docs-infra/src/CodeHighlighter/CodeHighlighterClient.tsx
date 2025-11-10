'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { Code, CodeHighlighterClientProps, ControlledCode, VariantCode } from './types';
import { CodeHighlighterContext, CodeHighlighterContextType } from './CodeHighlighterContext';
import { maybeCodeInitialData } from '../pipeline/loadCodeVariant/maybeCodeInitialData';
import { hasAllVariants } from '../pipeline/loadCodeVariant/hasAllCodeVariants';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { Selection, useControlledCode } from '../CodeControllerContext';
import { codeToFallbackProps } from './codeToFallbackProps';
import { mergeCodeMetadata } from '../pipeline/loadCodeVariant/mergeCodeMetadata';
import * as Errors from './errors';

const DEBUG = false; // Set to true for debugging purposes

function useInitialData({
  variants,
  variantName,
  code,
  setCode,
  fileName,
  url,
  highlightAfter,
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
  highlightAfter?: 'init' | 'hydration' | 'idle';
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  isControlled: boolean;
  globalsCode?: Array<Code | string>;
  setProcessedGlobalsCode: React.Dispatch<React.SetStateAction<Array<Code> | undefined>>;
}) {
  const { sourceParser, loadCodeMeta, loadVariantMeta, loadSource, loadCodeFallback } =
    useCodeContext();

  const { initialData, reason } = React.useMemo(
    () =>
      maybeCodeInitialData(
        variants,
        variantName,
        code,
        fileName,
        highlightAfter === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
      ),
    [
      variants,
      variantName,
      code,
      fileName,
      highlightAfter,
      fallbackUsesExtraFiles,
      fallbackUsesAllVariants,
    ],
  );

  const needsFallback = !initialData && !isControlled;
  if (needsFallback) {
    if (!url) {
      // URL is required for loading fallback data
      throw new Errors.ErrorCodeHighlighterClientMissingUrlForFallback();
    }

    if (!loadCodeFallback) {
      throw new Errors.ErrorCodeHighlighterClientMissingLoadFallbackCode(url);
    }
  }

  // TODO: fallbackInitialRenderOnly option? this would mean we can't fetch fallback data on the client side
  // Load initial data if not provided
  React.useEffect(() => {
    if (!needsFallback || !url || !loadCodeFallback) {
      return;
    }

    // TODO: abort controller

    (async () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('Loading initial data for CodeHighlighterClient: ', reason);
      }

      const loaded = await loadCodeFallback(url, variantName, code, {
        shouldHighlight: highlightAfter === 'init',
        fallbackUsesExtraFiles,
        fallbackUsesAllVariants,
        sourceParser,
        loadSource,
        loadVariantMeta,
        loadCodeMeta,
        initialFilename: fileName,
        variants,
        globalsCode, // Let loadCodeFallback handle processing
      }).catch((error: any) => ({ error }));

      if ('error' in loaded) {
        console.error(new Errors.ErrorCodeHighlighterClientLoadFallbackFailure(loaded.error));
      } else {
        setCode(loaded.code);
        // Store processed globalsCode from loadCodeFallback result
        if (loaded.processedGlobalsCode) {
          setProcessedGlobalsCode(loaded.processedGlobalsCode);
        }
      }
    })();
  }, [
    initialData,
    reason,
    needsFallback,
    variantName,
    code,
    setCode,
    highlightAfter,
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
    loadCodeFallback,
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
  const { loadCodeMeta, loadVariantMeta, loadSource, loadCodeVariant } = useCodeContext();

  const needsData = !readyForContent && !isControlled;

  // validation
  React.useMemo(() => {
    if (needsData) {
      if (!url) {
        throw new Errors.ErrorCodeHighlighterClientMissingUrlForVariants();
      }

      if (!loadCodeVariant) {
        throw new Errors.ErrorCodeHighlighterClientMissingLoadVariant(url);
      }

      if (!code && !loadCodeMeta) {
        throw new Errors.ErrorCodeHighlighterClientMissingLoadCodeMetaForNoCode(url);
      }

      if (
        globalsCode &&
        globalsCode.length > 0 &&
        globalsCode.some((item) => typeof item === 'string') &&
        !loadCodeMeta
      ) {
        throw new Errors.ErrorCodeHighlighterClientMissingLoadCodeMetaForGlobals();
      }

      if (!code && !loadSource) {
        throw new Errors.ErrorCodeHighlighterClientMissingLoadSourceForNoCode();
      }

      if (
        code &&
        Object.keys(code).some((variantName) => {
          const variant = code[variantName];
          if (!variant || typeof variant === 'string' || !variant.source) {
            return true;
          }

          const extraFiles = variant.extraFiles;
          if (
            extraFiles &&
            Object.keys(extraFiles).some(
              (fileName) =>
                !extraFiles[fileName] ||
                typeof extraFiles[fileName] === 'string' ||
                !extraFiles[fileName].source,
            )
          ) {
            return true;
          }
          return false;
        }) &&
        !loadSource
      ) {
        throw new Errors.ErrorCodeHighlighterClientMissingLoadSourceForUnloadedUrls();
      }
    }
  }, [code, globalsCode, loadCodeMeta, loadCodeVariant, loadSource, needsData, url]);

  React.useEffect(() => {
    if (!needsData || !url || !loadCodeVariant) {
      return;
    }

    // TODO: abort controller

    (async () => {
      try {
        let loadedCode = code;
        if (!loadedCode) {
          if (!loadCodeMeta) {
            throw new Errors.ErrorCodeHighlighterClientMissingLoadCodeMeta();
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
                  throw new Errors.ErrorCodeHighlighterClientMissingLoadCodeMeta();
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

            return loadCodeVariant(url, name, loadedCode[name], {
              disableParsing: true,
              disableTransforms: true,
              loadSource,
              loadVariantMeta,
              globalsCode: globalsForVariant,
            })
              .then((variant: any) => ({ name, variant }))
              .catch((error: any) => ({ error }));
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
          console.error(new Errors.ErrorCodeHighlighterClientLoadVariantsFailure(url!, errors));
        } else {
          setCode(resultCode);
        }
      } catch (error) {
        console.error(
          new Errors.ErrorCodeHighlighterClientLoadAllVariantsFailure(url!, error as Error),
        );
      }
    })();
  }, [
    needsData,
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
    loadCodeVariant,
  ]);

  return { readyForContent };
}

function yieldToMain(): Promise<void> {
  if ((globalThis as any).scheduler?.yield) {
    return (globalThis as any).scheduler.yield();
  }

  // Fall back to yielding with setTimeout.
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function useCodeParsing({
  code,
  readyForContent,
  highlightAfter,
  isHydrated,
  forceClient,
  url,
}: {
  code?: Code;
  readyForContent: boolean;
  highlightAfter?: 'init' | 'hydration' | 'idle';
  isHydrated: boolean;
  forceClient?: boolean;
  url?: string;
}) {
  const { parseSource, parseCode } = useCodeContext();

  const [isHighlightAllowed, setIsHighlightAllowed] = React.useState(
    highlightAfter === 'init' || (highlightAfter === 'hydration' && isHydrated),
  );

  React.useEffect(() => {
    if (highlightAfter === 'idle') {
      const requestIdleCallback = window.requestIdleCallback ?? setTimeout;
      const cancelIdleCallback = window.cancelIdleCallback ?? clearTimeout;

      const idleRequest = requestIdleCallback(() => {
        setIsHighlightAllowed(true);
      });
      return () => cancelIdleCallback(idleRequest);
    }
    return undefined;
  }, [highlightAfter]);

  // Update highlight allowed state when hydration completes
  React.useEffect(() => {
    if (highlightAfter === 'hydration' && isHydrated) {
      // we should ensure that each code highlighter is enhanced as a separate task
      // this should run from top to bottom
      yieldToMain().then(() => setIsHighlightAllowed(true));
    }
  }, [highlightAfter, isHydrated]);

  // Determine if we should highlight based on the highlightAfter setting
  const shouldHighlight = React.useMemo(() => {
    if (!readyForContent) {
      return false;
    }

    return isHighlightAllowed;
  }, [readyForContent, isHighlightAllowed]);

  // Parse the internal code state when ready and timing conditions are met
  const parsedCode = React.useMemo(() => {
    if (!code || !shouldHighlight || hasAllVariants(Object.keys(code), code, true)) {
      return undefined;
    }

    if (!parseSource) {
      if (forceClient) {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseSource(url, true));
      } else {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseSource(url, false));
      }
      return undefined;
    }
    if (!parseCode) {
      if (forceClient) {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseCode(url, true));
      } else {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseCode(url, false));
      }
      return undefined;
    }

    return parseCode(code, parseSource);
  }, [code, shouldHighlight, parseSource, parseCode, forceClient, url]);

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
  const { sourceParser, getAvailableTransforms, computeHastDeltas } = useCodeContext();
  const [transformedCode, setTransformedCode] = React.useState<Code | undefined>(undefined);

  // Get available transforms from the current variant (separate memo for efficiency)
  const availableTransforms = React.useMemo(() => {
    if (!getAvailableTransforms) {
      return [];
    }
    return getAvailableTransforms(parsedCode, variantName);
  }, [parsedCode, variantName, getAvailableTransforms]);

  // Effect to compute transformations for all variants
  React.useEffect(() => {
    if (!parsedCode || !sourceParser || !computeHastDeltas) {
      setTransformedCode(parsedCode);
      return;
    }

    // Process transformations for all variants
    (async () => {
      try {
        const parseSource = await sourceParser;
        const enhanced = await computeHastDeltas(parsedCode, parseSource);
        setTransformedCode(enhanced);
      } catch (error) {
        console.error(
          new Errors.ErrorCodeHighlighterClientTransformProcessingFailure(error as Error),
        );
        setTransformedCode(parsedCode);
      }
    })();
  }, [parsedCode, sourceParser, computeHastDeltas]);

  return { transformedCode, availableTransforms };
}

function useControlledCodeParsing({
  code,
  forceClient,
  url,
}: {
  code?: ControlledCode;
  forceClient?: boolean;
  url?: string;
}) {
  const { parseSource, parseControlledCode } = useCodeContext();

  // Parse the controlled code separately (no need to check readyForContent)
  const parsedControlledCode = React.useMemo(() => {
    if (!code) {
      return undefined;
    }

    if (!parseSource || !parseControlledCode) {
      // Log when provider functions are missing to help with debugging
      if (!parseSource) {
        if (forceClient) {
          console.error(new Errors.ErrorCodeHighlighterClientMissingParseSource(url, true));
        } else {
          console.error(new Errors.ErrorCodeHighlighterClientMissingParseSource(url, false));
        }
      }
      if (!parseControlledCode) {
        if (forceClient) {
          console.error(new Errors.ErrorCodeHighlighterClientMissingParseControlledCode(url, true));
        } else {
          console.error(
            new Errors.ErrorCodeHighlighterClientMissingParseControlledCode(url, false),
          );
        }
      }
      return undefined;
    }

    return parseControlledCode(code, parseSource);
  }, [code, parseSource, parseControlledCode, forceClient, url]);

  return { parsedControlledCode };
}

function useGlobalsCodeMerging({
  url,
  code,
  globalsCode,
  processedGlobalsCode,
  setProcessedGlobalsCode,
  readyForContent,
  variants,
}: {
  url?: string;
  code?: Code;
  globalsCode?: Array<Code | string>;
  processedGlobalsCode?: Array<Code>;
  setProcessedGlobalsCode: React.Dispatch<React.SetStateAction<Array<Code> | undefined>>;
  readyForContent: boolean;
  variants: string[];
}) {
  const { loadCodeMeta, loadSource, loadVariantMeta, loadCodeVariant } = useCodeContext();

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

    if (!loadCodeVariant) {
      console.error(new Errors.ErrorCodeHighlighterClientMissingLoadVariantForGlobals());
      return;
    }

    // Need to load string URLs or load missing variants
    (async () => {
      try {
        // First, load any string URLs into Code objects
        const basicCodeObjects = await Promise.all(
          globalsCode.map(async (item) => {
            if (typeof item === 'string') {
              if (!loadCodeMeta) {
                throw new Errors.ErrorCodeHighlighterClientMissingLoadCodeMetaForStringUrls();
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
                  const result = await loadCodeVariant(
                    originalUrl || '', // Use the original URL if available
                    variantName,
                    codeObj[variantName], // May be undefined or string
                    {
                      disableParsing: true,
                      disableTransforms: true,
                      loadSource,
                      loadVariantMeta,
                    },
                  );
                  loadedVariants[variantName] = result.code;
                } catch (error) {
                  console.error(
                    new Errors.ErrorCodeHighlighterClientLoadVariantFailureForGlobals(
                      variantName,
                      originalUrl,
                      error as Error,
                    ),
                  );
                  // Keep the original variant data (may be undefined)
                }
              }),
            );

            return loadedVariants;
          }),
        );

        setProcessedGlobalsCode(fullyLoadedCodeObjects);
      } catch (error) {
        console.error(
          new Errors.ErrorCodeHighlighterClientLoadGlobalsCodeFailure(
            url || 'No URL',
            error as Error,
          ),
        );
      }
    })();
  }, [
    url,
    globalsCode,
    processedGlobalsCode,
    setProcessedGlobalsCode,
    loadCodeMeta,
    loadSource,
    loadVariantMeta,
    variants,
    loadCodeVariant,
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
        // Use mergeCodeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeCodeMetadata
            const globalsMetadata: Record<string, any> = {};

            for (const [key, value] of Object.entries(globalVariant.extraFiles)) {
              if (typeof value === 'string') {
                globalsMetadata[key] = { source: value };
              } else {
                globalsMetadata[key] = { ...value };
              }
            }

            // Use mergeCodeMetadata to properly position and merge the globals
            currentVariant = mergeCodeMetadata(currentVariant, globalsMetadata);
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
        // Use mergeCodeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeCodeMetadata
            const globalsMetadata: Record<string, any> = {};

            for (const [key, value] of Object.entries(globalVariant.extraFiles)) {
              if (typeof value === 'string') {
                globalsMetadata[key] = { source: value };
              } else {
                globalsMetadata[key] = { ...value };
              }
            }

            // Use mergeCodeMetadata to properly position and merge the globals
            currentVariant = mergeCodeMetadata(currentVariant, globalsMetadata);
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
  const controlled = useControlledCode();

  const isControlled = Boolean(props.code || controlled?.code);

  const [code, setCode] = React.useState(
    typeof props.precompute === 'object' ? props.precompute : undefined,
  );

  // Sync code state with precompute prop changes (for hot-reload)
  React.useEffect(() => {
    if (typeof props.precompute === 'object') {
      setCode(props.precompute);
    } else if (props.precompute === undefined) {
      // Only reset to undefined if precompute is explicitly undefined
      setCode(undefined);
    }
  }, [props.precompute]);

  // State to store processed globalsCode to avoid duplicate loading
  const [processedGlobalsCode, setProcessedGlobalsCode] = React.useState<Array<Code> | undefined>(
    undefined,
  );

  const activeCode = controlled?.code || props.code || code;
  const variants = React.useMemo(
    () => props.variants || Object.keys(props.components || activeCode || {}),
    [props.variants, props.components, activeCode],
  );

  // TODO: if using props.variant, then the variant is controlled and we can't use our own state
  // does props.variant make any sense instead of controlledSelection?.variant?
  const [selection, setSelection] = React.useState<Selection>({
    variant: props.initialVariant || props.defaultVariant || variants[0],
  });

  const variantName = controlled?.selection?.variant || props.variant || selection.variant;

  let initialFilename: string | undefined;
  if (typeof activeCode?.[variantName] === 'object') {
    const variant = activeCode[variantName];
    initialFilename = variant?.filesOrder ? variant.filesOrder[0] : variant?.fileName;
  }
  const fileName = controlled?.selection?.fileName || props.fileName || initialFilename;

  const { url, highlightAfter, enhanceAfter, fallbackUsesExtraFiles, fallbackUsesAllVariants } =
    props;

  useInitialData({
    variants,
    variantName,
    code,
    setCode,
    fileName,
    url,
    highlightAfter,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    isControlled,
    globalsCode: props.globalsCode,
    setProcessedGlobalsCode,
  });

  // Use useSyncExternalStore to detect hydration
  const subscribe = React.useCallback(() => () => {}, []);
  const getSnapshot = React.useCallback(() => true, []);
  const getServerSnapshot = React.useCallback(() => false, []);
  const useIsHydrated = () => React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isHydrated = useIsHydrated();
  const [isEnhanceAllowed, setIsEnhanceAllowed] = React.useState(
    enhanceAfter === 'init' || (enhanceAfter === 'hydration' && isHydrated),
  );

  React.useEffect(() => {
    if (enhanceAfter === 'idle') {
      const requestIdleCallback = window.requestIdleCallback ?? setTimeout;
      const cancelIdleCallback = window.cancelIdleCallback ?? clearTimeout;

      const idleRequest = requestIdleCallback(() => {
        setIsEnhanceAllowed(true);
      });
      return () => cancelIdleCallback(idleRequest);
    }
    return undefined;
  }, [enhanceAfter]);

  // Update enhance allowed state when hydration completes
  React.useEffect(() => {
    if (enhanceAfter === 'hydration' && isHydrated) {
      // we should ensure that each code highlighter is enhanced as a separate task
      // this should run from top to bottom
      yieldToMain().then(() => setIsEnhanceAllowed(true));
    }
  }, [enhanceAfter, isHydrated]);

  const readyForContent = React.useMemo(() => {
    if (!code) {
      return false;
    }

    return hasAllVariants(variants, code);
  }, [code, variants]);

  // Separate check for activeCode to determine when to show fallback
  const activeCodeReady = React.useMemo(() => {
    if (!activeCode || !isEnhanceAllowed) {
      return false;
    }

    // Controlled code is always ready since it comes from editing already-ready code
    if (controlled?.code) {
      return true;
    }

    // For regular code, use the existing hasAllVariants function
    const regularCode = props.code || code;
    return regularCode ? hasAllVariants(variants, regularCode) : false;
  }, [activeCode, isEnhanceAllowed, controlled?.code, variants, props.code, code]);

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
    url,
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
    highlightAfter,
    isHydrated,
    forceClient: props.forceClient,
    url: props.url,
  });

  const { transformedCode, availableTransforms } = useCodeTransforms({
    parsedCode,
    variantName,
  });

  const { parsedControlledCode } = useControlledCodeParsing({
    code: controlled?.code,
    forceClient: props.forceClient,
    url: props.url,
  });

  // Determine the final overlaid code (controlled takes precedence)
  const overlaidCode = parsedControlledCode || transformedCode || codeWithGlobals;

  // For fallback context, use the processed code or fall back to non-controlled code
  const codeForFallback = overlaidCode || (controlled?.code ? undefined : props.code || code);

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
      setCode: controlled?.setCode,
      selection: controlled?.selection || selection,
      setSelection: controlled?.setSelection || setSelection,
      components: controlled?.components || props.components,
      availableTransforms: isControlled ? [] : availableTransforms,
      url: props.url,
      deferHighlight,
    }),
    [
      overlaidCode,
      controlled?.setCode,
      selection,
      controlled?.selection,
      controlled?.setSelection,
      controlled?.components,
      props.components,
      isControlled,
      availableTransforms,
      props.url,
      deferHighlight,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Errors.ErrorCodeHighlighterClientMissingData();
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
