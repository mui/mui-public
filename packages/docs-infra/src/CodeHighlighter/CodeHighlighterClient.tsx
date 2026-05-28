'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import {
  type Code,
  type CodeHighlighterClientProps,
  type ControlledCode,
  type VariantCode,
  type VariantExtraFiles,
} from './types';
import {
  CodeHighlighterContext,
  type CodeHighlighterContextType,
  type PreParsedCacheEntry,
} from './CodeHighlighterContext';
import { maybeCodeInitialData } from '../pipeline/loadIsomorphicCodeVariant/maybeCodeInitialData';
import { hasAllVariants } from '../pipeline/loadIsomorphicCodeVariant/hasAllCodeVariants';
import { CodeHighlighterFallbackContext } from './CodeHighlighterFallbackContext';
import { type Selection, useControlledCode } from '../CodeControllerContext';
import { codeToFallbackProps } from './codeToFallbackProps';
import { mergeCodeMetadata } from '../pipeline/loadIsomorphicCodeVariant/mergeCodeMetadata';
import { getAvailableTransforms } from '../pipeline/loadIsomorphicCodeVariant/getAvailableTransforms';
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
  const {
    sourceParser,
    loadCodeMeta,
    loadVariantMeta,
    loadSource,
    loadCodeFallback,
    sourceEnhancers,
  } = useCodeContext();

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

  // Signal to downstream loaders that a fallback fetch is pending. Used to gate
  // `useAllVariants` so it can reuse the data populated by the fallback rather
  // than racing it and re-fetching the same variant.
  const fallbackPending = Boolean(needsFallback && url && loadCodeFallback);

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
        sourceEnhancers,
        initialFilename: fileName,
        variants,
        globalsCode, // Let loadCodeFallback handle processing
      }).catch((error: unknown) => ({
        error: error instanceof Error ? error : new Error(String(error)),
      }));

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
    sourceEnhancers,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    fileName,
    variants,
    globalsCode,
    setProcessedGlobalsCode,
    loadCodeFallback,
  ]);

  return { fallbackPending };
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
  fallbackPending,
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
  fallbackPending: boolean;
}) {
  const { loadCodeMeta, loadVariantMeta, loadSource, loadIsomorphicCodeVariant, sourceEnhancers } =
    useCodeContext();

  const needsData = !readyForContent && !isControlled && !fallbackPending;

  // validation
  React.useMemo(() => {
    if (needsData) {
      if (!url) {
        throw new Errors.ErrorCodeHighlighterClientMissingUrlForVariants();
      }

      if (!loadIsomorphicCodeVariant) {
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
  }, [code, globalsCode, loadCodeMeta, loadIsomorphicCodeVariant, loadSource, needsData, url]);

  React.useEffect(() => {
    if (!needsData || !url || !loadIsomorphicCodeVariant) {
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
              .filter((item): item is VariantCode | string => Boolean(item));

            return loadIsomorphicCodeVariant(url, name, loadedCode[name], {
              disableParsing: true,
              disableTransforms: true,
              loadSource,
              loadVariantMeta,
              sourceEnhancers,
              globalsCode: globalsForVariant,
            })
              .then((variant) => ({ name, variant }))
              .catch((error: unknown) => ({
                error: error instanceof Error ? error : new Error(String(error)),
              }));
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
    sourceEnhancers,
    processedGlobalsCode,
    globalsCode,
    setProcessedGlobalsCode,
    loadIsomorphicCodeVariant,
  ]);

  return { readyForContent };
}

function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
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
  const { sourceParser, parseSource, parseCode } = useCodeContext();

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

  // Memoize the "every variant is already in HAST form" check so it
  // doesn't re-walk the variant + extraFiles trees on every render.
  // Used both as the short-circuit inside the `parseCode` memo (fully-
  // precomputed sites skip parsing entirely) and as the unmemoized
  // `waitingForParsedCode` gate just below.
  const allVariantsAlreadyHighlighted = React.useMemo(
    () => (code ? hasAllVariants(Object.keys(code), code, true) : false),
    [code],
  );

  // Parse the internal code state when ready and timing conditions are met
  const parsedCode = React.useMemo(() => {
    if (!code || !shouldHighlight || allVariantsAlreadyHighlighted) {
      return undefined;
    }

    if (!parseSource) {
      // A CodeProvider is present and its async `sourceParser` promise hasn't
      // resolved yet — wait for it instead of erroring. The memo will re-run
      // once `parseSource` is populated.
      if (sourceParser) {
        return undefined;
      }
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
  }, [
    code,
    shouldHighlight,
    allVariantsAlreadyHighlighted,
    sourceParser,
    parseSource,
    parseCode,
    forceClient,
    url,
  ]);

  // Keep highlighting deferred until parsed HAST is actually available for the
  // variants that need it. `shouldHighlight` can flip true ~30ms after
  // hydration, but `parseCode` only runs once the async `sourceParser` promise
  // resolves. Without this wait, downstream consumers (e.g. the transform
  // swap) would commit while the visible variant is still rendered from its
  // raw string source, producing a structure swap on the DOM moments later.
  const waitingForParsedCode =
    shouldHighlight && !!code && !allVariantsAlreadyHighlighted && !parsedCode;

  // Only signal `deferHighlight` while a highlight pass is actively in
  // flight. When `shouldHighlight` is `false` (e.g. `highlightAt: 'idle'`
  // before the idle window fires, or `'view'` before the block scrolls
  // into view) we render the un-highlighted source as-is — downstream
  // consumers like `useTransformManagement`'s `awaitHighlight` gate must
  // commit eagerly against that source instead of blocking the barrier
  // indefinitely. Once the trigger fires, `shouldHighlight` flips true,
  // `waitingForParsedCode` becomes true while `parseCode` runs, and
  // `deferHighlight` engages for the brief window before the next
  // commit paints the highlighted tree.
  const deferHighlight = waitingForParsedCode;

  return { parsedCode, deferHighlight };
}

function useCodeTransforms({
  parsedCode,
  loadedCode,
  variantName,
}: {
  parsedCode?: Code;
  // Read the transforms manifest from here when `parsedCode` is undefined
  // (fully-precomputed variants short-circuit `useCodeParsing`).
  loadedCode?: Code;
  variantName: string;
}) {
  const { sourceParser, computeHastDeltas } = useCodeContext();
  // Track which `parsedCode` the cached `transformedCode` was computed from
  // so a fresh `parsedCode` (e.g. a newly-loaded variant being added to the
  // map) re-engages `waitingForTransformedCode` instead of returning the
  // stale output for one render cycle. Storing input + output together lets
  // callers detect staleness with reference equality.
  const [transformedState, setTransformedState] = React.useState<{
    input?: Code;
    output?: Code;
  }>({});

  // Get available transforms from the current variant (separate memo for efficiency)
  const availableTransforms = React.useMemo(
    () => getAvailableTransforms(parsedCode ?? loadedCode, variantName),
    [parsedCode, loadedCode, variantName],
  );

  // Effect to compute transformations for all variants
  React.useEffect(() => {
    if (!parsedCode || !sourceParser || !computeHastDeltas) {
      setTransformedState({ input: parsedCode, output: parsedCode });
      return;
    }

    // Process transformations for all variants
    (async () => {
      try {
        const parseSource = await sourceParser;
        const enhanced = await computeHastDeltas(parsedCode, parseSource);
        setTransformedState({ input: parsedCode, output: enhanced });
      } catch (error) {
        console.error(
          new Errors.ErrorCodeHighlighterClientTransformProcessingFailure(error as Error),
        );
        setTransformedState({ input: parsedCode, output: parsedCode });
      }
    })();
  }, [parsedCode, sourceParser, computeHastDeltas]);

  // Expose the cached output regardless of whether `parsedCode` changed since
  // the last computation — falling back to `undefined` here would yank the
  // currently-displayed HAST for a frame while the async pipeline catches up.
  // Staleness is signalled via `waitingForTransformedCode` so downstream
  // gates (e.g. `useTransformManagement` / `useVariantSelection`) hold off
  // committing a swap until fresh deltas land.
  const transformedCode = transformedState.output;

  // Async hast-deltas pipeline status. While true, consumers (notably
  // `useTransformManagement`'s `deferHighlight` gate) should treat
  // highlighting as not-yet-settled and hold off committing a transform
  // swap. Without this, the swap can commit after `parsedCode` is ready
  // but *before* `computeHastDeltas` resolves: the incoming tree first
  // renders without the transform deltas, then re-renders a frame or
  // two later when `transformedCode` arrives, producing a visible jump
  // on top of the just-played collapse animation.
  //
  // Only relevant when both a worker (`sourceParser`) and a deltas
  // computer (`computeHastDeltas`) are wired up — environments without
  // them resolve `transformedCode` synchronously to `parsedCode` in the
  // effect above, so the deltas phase is a no-op. We compare the cached
  // `input` against the live `parsedCode` instead of just checking
  // `!transformedCode` so a freshly-arriving variant re-engages the wait
  // until its deltas land.
  const waitingForTransformedCode =
    !!parsedCode && !!sourceParser && !!computeHastDeltas && transformedState.input !== parsedCode;

  return { transformedCode, availableTransforms, waitingForTransformedCode };
}

function useControlledCodeParsing({
  code,
  forceClient,
  url,
  preParsedCache,
}: {
  code?: ControlledCode;
  forceClient?: boolean;
  url?: string;
  preParsedCache?: Map<string, PreParsedCacheEntry>;
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

    return parseControlledCode(code, parseSource, preParsedCache);
  }, [code, parseSource, parseControlledCode, forceClient, url, preParsedCache]);

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
  const { loadCodeMeta, loadSource, loadVariantMeta, loadIsomorphicCodeVariant } = useCodeContext();

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

    if (!loadIsomorphicCodeVariant) {
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
                  const result = await loadIsomorphicCodeVariant(
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
    loadIsomorphicCodeVariant,
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
        .filter((item): item is VariantCode => Boolean(item) && typeof item === 'object');

      if (globalsForVariant.length > 0) {
        // Use mergeCodeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeCodeMetadata
            const globalsMetadata: VariantExtraFiles = {};

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
        .filter((item): item is VariantCode => Boolean(item) && typeof item === 'object');

      if (globalsForVariant.length > 0) {
        // Use mergeCodeMetadata for sophisticated globals merging with proper positioning
        let currentVariant = variantData;

        globalsForVariant.forEach((globalVariant) => {
          if (globalVariant.extraFiles) {
            // Convert globals extraFiles to metadata format for mergeCodeMetadata
            const globalsMetadata: VariantExtraFiles = {};

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

  const { fallbackPending } = useInitialData({
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
    fallbackPending,
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

  const { parsedCode, deferHighlight: deferHighlightForParsing } = useCodeParsing({
    code: codeWithGlobals,
    readyForContent: readyForContent || Boolean(props.code),
    highlightAfter,
    isHydrated,
    forceClient: props.forceClient,
    url: props.url,
  });

  const { transformedCode, availableTransforms, waitingForTransformedCode } = useCodeTransforms({
    parsedCode,
    loadedCode: codeWithGlobals,
    variantName,
  });

  // Combined highlight-readiness gate consumed via context (notably by
  // `useTransformManagement`). Stay deferred while either the sync
  // `parseCode` pass or the async `computeHastDeltas` pass is still in
  // flight — committing a transform swap with `transformedCode` still
  // pending causes the incoming pre to first render without the
  // transform deltas and then re-flow a frame or two later when the
  // deltas land, producing a visible jump on top of the collapse
  // animation. The wait only matters for highlighters with at least one
  // applicable transform; plain (variant-only) highlighters skip it so
  // their stored-preference resolution doesn't pay the deltas latency.
  const deferHighlight =
    deferHighlightForParsing || (availableTransforms.length > 0 && waitingForTransformedCode);

  // Per-highlighter pre-parsed HAST cache. Lives in a ref so the same Map
  // instance is shared across renders without becoming a React dep. The
  // editable populates it via `useSourceEditing` (which reads it from
  // `CodeHighlighterContext`), and `parseControlledCode` consults it on
  // every render to skip the sync main-thread parse on exact source matches.
  const [preParsedCache] = React.useState<Map<string, PreParsedCacheEntry>>(() => new Map());

  const { parsedControlledCode } = useControlledCodeParsing({
    code: controlled?.code,
    forceClient: props.forceClient,
    url: props.url,
    preParsedCache,
  });

  // Determine the final overlaid code (controlled takes precedence)
  const overlaidCode = parsedControlledCode || transformedCode || codeWithGlobals;

  // For fallback context, use the processed code or fall back to non-controlled code
  const codeForFallback = overlaidCode || (controlled?.code ? undefined : props.code || code);

  const fallbackContext = React.useMemo(
    () =>
      activeCodeReady
        ? undefined
        : codeToFallbackProps(
            variantName,
            codeForFallback,
            fileName,
            props.fallbackUsesExtraFiles,
            props.fallbackUsesAllVariants,
          ),
    [
      activeCodeReady,
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
      // Only suppress when an external CodeController owns the code; static
      // `props.code` still needs the locally-computed list.
      availableTransforms: controlled?.code ? [] : availableTransforms,
      url: props.url,
      deferHighlight,
      preParsedCache,
    }),
    [
      overlaidCode,
      controlled?.setCode,
      selection,
      controlled?.selection,
      controlled?.setSelection,
      controlled?.components,
      props.components,
      controlled?.code,
      availableTransforms,
      props.url,
      deferHighlight,
      preParsedCache,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Errors.ErrorCodeHighlighterClientMissingData();
  }

  // If this CodeHighlighter is nested inside another CodeHighlighter that is
  // currently rendering its fallback, hold our own fallback->full transition
  // until the outer one swaps. Otherwise, when the outer swaps from its
  // fallback element to its children element, our subtree unmounts and a fresh
  // inner instance mounts and re-runs its own fallback->full transition,
  // producing a visible "fallback -> full -> fallback -> full" flicker. By
  // staying in fallback while nested, we collapse this to a single transition
  // that happens after the outer is fully rendered.
  const outerFallbackContext = React.useContext(CodeHighlighterFallbackContext);
  const isNestedInsideOuterFallback = outerFallbackContext !== undefined;

  const fallback = props.fallback;
  if (fallback && !props.skipFallback && (!activeCodeReady || isNestedInsideOuterFallback)) {
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
