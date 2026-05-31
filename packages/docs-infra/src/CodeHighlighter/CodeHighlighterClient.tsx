'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import {
  type Code,
  type CodeHighlighterClientProps,
  type ControlledCode,
  type Fallbacks,
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
import {
  codeToFallbackProps,
  deriveFallbacksFromCode,
  stripFallbackHastsFromCode,
} from './codeToFallbackProps';
import {
  decompressResidualFallbacks,
  residualDictionaryText,
  scatterResidualFallbacks,
} from './fallbackCompression';
import { mergeCodeMetadata } from '../pipeline/loadIsomorphicCodeVariant/mergeCodeMetadata';
import { getAvailableTransforms } from '../pipeline/loadIsomorphicCodeVariant/getAvailableTransforms';
import { useSpeculativeCodePreload } from './useSpeculativeCodePreload';
import { useSpeculativeEditingPreload } from './useSpeculativeEditingPreload';
import { useCoordinatedSwap } from '../CoordinatedLazy/useCoordinatedSwap';
import { CoordinatedFallbackContext } from '../CoordinatedLazy/CoordinatedFallbackContext';
import { CoordinatedContentContext } from '../CoordinatedLazy/CoordinatedContentContext';
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
  handleSetFallbackHasts,
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
  handleSetFallbackHasts: (variant: string, hasts: Fallbacks) => void;
}) {
  const {
    sourceParser,
    loadCodeMeta,
    loadVariantMeta,
    loadSource,
    loadCodeFallbackLoader,
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

    // Validate against the loader accessor's presence (synchronously defined
    // whenever a CodeProvider is mounted) - never against the resolved fn, so we
    // don't throw merely because a lazy import is still in flight.
    if (!loadCodeFallbackLoader) {
      throw new Errors.ErrorCodeHighlighterClientMissingLoadFallbackCode(url);
    }
  }

  // Signal to downstream loaders that a fallback fetch is pending. Used to gate
  // `useAllVariants` so it can reuse the data populated by the fallback rather
  // than racing it and re-fetching the same variant.
  const fallbackPending = Boolean(needsFallback && url && loadCodeFallbackLoader);

  // TODO: fallbackInitialRenderOnly option? this would mean we can't fetch fallback data on the client side
  // Load initial data if not provided
  React.useEffect(() => {
    if (!needsFallback || !url || !loadCodeFallbackLoader) {
      return;
    }

    // TODO: abort controller

    (async () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('Loading initial data for CodeHighlighterClient: ', reason);
      }

      // Lazily resolve the heavy fallback loader (instant under an eager
      // CodeProvider, a deduped fetch under CodeProviderLazy) before loading.
      const loadCodeFallback = await loadCodeFallbackLoader();

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
        // Strip fallbacks from code and hoist them directly
        const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(
          loaded.code,
          variantName,
          fallbackUsesExtraFiles,
          fallbackUsesAllVariants,
        );
        setCode(strippedCode);
        for (const [variant, hasts] of Object.entries(allFallbackHasts)) {
          handleSetFallbackHasts(variant, hasts);
        }
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
    loadCodeFallbackLoader,
    handleSetFallbackHasts,
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
  const {
    loadCodeMeta,
    loadVariantMeta,
    loadSource,
    loadIsomorphicCodeVariantLoader,
    sourceEnhancers,
  } = useCodeContext();

  const needsData = !readyForContent && !isControlled && !fallbackPending;

  // validation
  React.useMemo(() => {
    if (needsData) {
      if (!url) {
        throw new Errors.ErrorCodeHighlighterClientMissingUrlForVariants();
      }

      if (!loadIsomorphicCodeVariantLoader) {
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
  }, [
    code,
    globalsCode,
    loadCodeMeta,
    loadIsomorphicCodeVariantLoader,
    loadSource,
    needsData,
    url,
  ]);

  React.useEffect(() => {
    if (!needsData || !url || !loadIsomorphicCodeVariantLoader) {
      return;
    }

    // TODO: abort controller

    (async () => {
      try {
        // Lazily resolve the heavy variant loader (instant under an eager
        // CodeProvider, a deduped fetch under CodeProviderLazy) before loading.
        const loadIsomorphicCodeVariant = await loadIsomorphicCodeVariantLoader();

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
    loadIsomorphicCodeVariantLoader,
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

  // Render-side readiness gate. `<Pre>` (via `useCode.shouldHighlight`)
  // needs to know whether the published `code` should be rendered as
  // highlighted HAST *now*. That answer is false in two distinct
  // windows that `deferHighlight` deliberately collapses out:
  //   1. The trigger for `highlightAt: 'hydration' | 'idle' | 'visible'`
  //      hasn't fired yet — `shouldHighlight` is still false. The
  //      precomputed `codeWithGlobals` already contains HAST, so
  //      without a render-side gate `<Pre>` would render highlighted
  //      spans on the SSR pass and on first client paint, defeating
  //      the whole point of deferred highlighting.
  //   2. The trigger has fired (`shouldHighlight = true`) but
  //      `parseCode` hasn't resolved yet (`waitingForParsedCode`).
  //      Rendering would briefly flash un-highlighted text against
  //      the same tree position before the highlighted HAST lands.
  //
  // `highlightReady` is the inverse of the pre-`e7cc08b7` wide
  // `deferHighlight` semantic, exposed separately so the narrow
  // `deferHighlight` (barrier consumers only block on real in-flight
  // work) and the render gate can diverge without coupling.
  const highlightReady = shouldHighlight && !waitingForParsedCode;

  return { parsedCode, deferHighlight, highlightReady };
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
  const { sourceParser, computeHastDeltasLoader } = useCodeContext();
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
    if (!parsedCode || !sourceParser || !computeHastDeltasLoader) {
      setTransformedState({ input: parsedCode, output: parsedCode });
      return;
    }

    // Process transformations for all variants
    (async () => {
      try {
        // Resolve the parser and the (lazy) transform-delta computer in parallel
        // before computing deltas. computeHastDeltas pulls jsondiffpatch, so it's
        // kept out of the initial bundle under CodeProviderLazy.
        const [parseSource, computeHastDeltas] = await Promise.all([
          sourceParser,
          computeHastDeltasLoader(),
        ]);
        const enhanced = await computeHastDeltas(parsedCode, parseSource);
        setTransformedState({ input: parsedCode, output: enhanced });
      } catch (error) {
        console.error(
          new Errors.ErrorCodeHighlighterClientTransformProcessingFailure(error as Error),
        );
        setTransformedState({ input: parsedCode, output: parsedCode });
      }
    })();
  }, [parsedCode, sourceParser, computeHastDeltasLoader]);

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
    !!parsedCode &&
    !!sourceParser &&
    !!computeHastDeltasLoader &&
    transformedState.input !== parsedCode;

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
  const { sourceParser, parseSource, parseControlledCode } = useCodeContext();

  // Parse the controlled code separately (no need to check readyForContent)
  const parsedControlledCode = React.useMemo(() => {
    if (!code) {
      return undefined;
    }

    if (!parseSource) {
      // A CodeProvider is present and its async `sourceParser` promise hasn't
      // resolved yet (e.g. CodeProviderLazy dynamic-importing the engine) — wait
      // for it instead of erroring. The memo re-runs once `parseSource` lands.
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

    if (!parseControlledCode) {
      if (forceClient) {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseControlledCode(url, true));
      } else {
        console.error(new Errors.ErrorCodeHighlighterClientMissingParseControlledCode(url, false));
      }
      return undefined;
    }

    return parseControlledCode(code, parseSource, preParsedCache);
  }, [code, sourceParser, parseSource, parseControlledCode, forceClient, url, preParsedCache]);

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
  const { loadCodeMeta, loadSource, loadVariantMeta, loadIsomorphicCodeVariantLoader } =
    useCodeContext();

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

    if (!loadIsomorphicCodeVariantLoader) {
      console.error(new Errors.ErrorCodeHighlighterClientMissingLoadVariantForGlobals());
      return;
    }

    // Need to load string URLs or load missing variants
    (async () => {
      try {
        const loadIsomorphicCodeVariant = await loadIsomorphicCodeVariantLoader();

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
    loadIsomorphicCodeVariantLoader,
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

  const {
    url,
    highlightAfter,
    enhanceAfter,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    editActivation,
  } = props;

  // Speculative preload: on first render, start fetching the heavy loaders this
  // block is about to need (under CodeProviderLazy) so they're in flight before
  // the content mounts and awaits them. Signals are cheap + accurate, so a
  // precomputed or code-free block preloads nothing.
  // Only the precomputed/loaded (non-controlled) code drives speculative loading.
  const speculativeCode = isControlled ? undefined : code;
  const speculativeAllPresent = React.useMemo(
    () => (speculativeCode ? hasAllVariants(variants, speculativeCode) : false),
    [variants, speculativeCode],
  );
  const speculativeHasTransforms = React.useMemo(
    () =>
      !!speculativeCode &&
      !hasAllVariants(variants, speculativeCode, true) &&
      getAvailableTransforms(speculativeCode, variantName).length > 0,
    [variants, speculativeCode, variantName],
  );
  useSpeculativeCodePreload({
    needsData: !isControlled && !!url && !speculativeAllPresent,
    hasTransforms: speculativeHasTransforms,
  });

  // When the block is editable (a CodeControllerContext with `setCode` is in
  // scope), preload the live-editing engine so it is in flight before the user
  // engages the code. Deduped page-wide with `useEditable`'s own load. Skipped
  // when `editActivation: 'interaction'` — that mode defers the load until the
  // reader engages the block, so prefetching would defeat its purpose.
  useSpeculativeEditingPreload({ enabled: Boolean(controlled?.setCode), editActivation });

  // ── Fallback hoisting ──
  // State for fallbacks hoisted from ContentLoading via useCodeFallback.
  // Content is stripped from Code on the server and passed to ContentLoading
  // as source/extraSource props. ContentLoading hoists them back here so
  // CodeHighlighterClient can derive text dictionaries for decompression.
  const [hoistedFallbackHasts, setHoistedFallbackHasts] = React.useState<Record<string, Fallbacks>>(
    {},
  );

  // Track whether ContentLoading called useCodeFallback via callback. The
  // force-mount-once behavior (mounting the fallback even when the code is
  // already ready, so `useCodeFallback` can hoist the DEFLATE dictionary) is now
  // owned by `useCoordinatedSwap` below; this ref only drives the dev-time
  // validation that ContentLoading wired its hoist hook.
  const hookCalledRef = React.useRef(false);
  const handleHookCalled = React.useCallback(() => {
    hookCalledRef.current = true;
  }, []);

  // Stable callback for ContentLoading to hoist its fallbacks.
  const handleSetFallbackHasts = React.useCallback((variant: string, hasts: Fallbacks) => {
    setHoistedFallbackHasts((prev) => {
      if (prev[variant] === hasts) {
        return prev;
      }
      return { ...prev, [variant]: hasts };
    });
  }, []);

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
    handleSetFallbackHasts,
  });

  // Reverse the server-side residual consolidation. The blob is primed with the
  // rendered subset's text, which only reaches the client via the hoist — so we
  // wait for `hoistedFallbackHasts[variantName]` (the rendered initial variant,
  // hoisted atomically) before decompressing. Residual files are hidden until a
  // post-hoist swap, so deferring costs nothing; if the hoist never arrives the
  // existing fallback-hoist check throws anyway.
  const residualFallbacks = props.residualFallbacks;
  const renderedHoist = hoistedFallbackHasts[variantName];
  const residualMap = React.useMemo(() => {
    if (!residualFallbacks || !renderedHoist) {
      return undefined;
    }
    return decompressResidualFallbacks(
      residualFallbacks,
      residualDictionaryText(hoistedFallbackHasts),
    );
  }, [residualFallbacks, renderedHoist, hoistedFallbackHasts]);

  // Scatter the residual back onto whichever code carries it. Memoized so the
  // freshly-cloned code keeps a stable identity until the residual or its base
  // changes (the downstream merges/parses are keyed on it).
  const resolvedPropsCode = React.useMemo(
    () =>
      props.code && residualMap ? scatterResidualFallbacks(props.code, residualMap) : props.code,
    [props.code, residualMap],
  );
  const resolvedStateCode = React.useMemo(
    () => (code && residualMap ? scatterResidualFallbacks(code, residualMap) : code),
    [code, residualMap],
  );

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
    code: resolvedStateCode, // Only use internal state, not props.code
    globalsCode: props.globalsCode,
    processedGlobalsCode,
    setProcessedGlobalsCode,
    readyForContent,
    variants,
  });

  // For props.code (controlled), always re-merge when it changes (don't cache in state)
  const propsCodeWithGlobals = usePropsCodeGlobalsMerging({
    code: resolvedPropsCode,
    globalsCode: props.globalsCode,
    processedGlobalsCode,
    variants,
  });

  // Use props.code result if available, otherwise use state code result
  const codeWithGlobals = propsCodeWithGlobals || stateCodeWithGlobals;

  const {
    parsedCode,
    deferHighlight: deferHighlightForParsing,
    highlightReady,
  } = useCodeParsing({
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

  // The fallback↔content swap, generalized into `useCoordinatedSwap`: it owns
  // the force-mount-once behavior, nested-fallback suppression (via the shared
  // `CoordinatedFallbackContext`), and registration with the page-wide settle
  // gate. `holdGate={deferHighlight}` keeps the gate open while the content
  // stays rendered (the highlighter shows plain text, then highlights in place)
  // rather than re-showing the fallback. CH keeps its own hoist state, residual
  // decompression, and `CodeHighlighterContext`/`CodeHighlighterFallbackContext`.
  const {
    showFallback,
    fallbackContext: coordinatedFallbackContext,
    hoisted,
  } = useCoordinatedSwap({
    ready: activeCodeReady,
    holdGate: deferHighlight,
    hasFallback: !!props.fallback,
    skipFallback: props.skipFallback,
  });

  // Validate that ContentLoading calls useCodeFallback(props). Child effects
  // fire before parent effects, so hookCalledRef is set by the time this runs.
  React.useEffect(() => {
    if (showFallback && !hookCalledRef.current) {
      throw new Errors.ErrorCodeHighlighterClientMissingFallbackHoist();
    }
  }, [showFallback]);

  // A dynamically-imported content (e.g. `LazyContent`) calls `reportReady` — via
  // the `CoordinatedContentContext` provided around `children` below — once its
  // `import()` resolves. Without a `ContentLoading` there is nothing to cover that
  // load (the slot would flash empty), so fail fast instead.
  const fallbackProvided = !!props.fallback;
  const reportContentReady = React.useCallback(() => {
    if (!fallbackProvided) {
      throw new Errors.ErrorCodeHighlighterClientDynamicContentRequiresFallback();
    }
  }, [fallbackProvided]);

  // Hand the loading `fallback` down to the content so a dynamically-imported
  // content (`LazyContent`) shows the *same* `ContentLoading` as its Suspense
  // fallback while its chunk loads - the placeholder the swap showed keeps
  // covering the load, with no empty flash and no double render.
  const contentContext = React.useMemo(
    () => ({ hoisted, reportReady: reportContentReady, fallback: props.fallback }),
    [hoisted, reportContentReady, props.fallback],
  );

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
  const codeForFallback =
    overlaidCode || (controlled?.code ? undefined : resolvedPropsCode || resolvedStateCode);

  // Resolve the active variant's fallbacks from the two places one can cross
  // the server→client boundary: the hoisted copy (from a `ContentLoading`
  // component, which had it stripped off `Code`) and the variant's own
  // `fallback` field on `Code` (present without a `ContentLoading`, or scattered
  // back from the residual blob). For most files only one is populated. When
  // both are — a `fallbackCollapsed` block hoists the *visible* window but
  // scatters the *full* fallback onto `Code` — the `Code` copy must win, since
  // the full text is the DEFLATE dictionary `hastCompressed` needs. So merge
  // with the derived (`Code`) copy taking precedence.
  const activeFallbacks = React.useMemo(() => {
    const merged = {
      ...hoistedFallbackHasts[variantName],
      ...deriveFallbacksFromCode(codeForFallback, variantName),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [hoistedFallbackHasts, variantName, codeForFallback]);

  const fallbackContext = React.useMemo(
    () => ({
      extraVariants: codeToFallbackProps(
        variantName,
        codeForFallback,
        fileName,
        props.fallbackUsesExtraFiles,
        props.fallbackUsesAllVariants,
      ).extraVariants,
      setFallbackHasts: handleSetFallbackHasts,
      onHookCalled: handleHookCalled,
    }),
    [
      variantName,
      codeForFallback,
      fileName,
      props.fallbackUsesExtraFiles,
      props.fallbackUsesAllVariants,
      handleSetFallbackHasts,
      handleHookCalled,
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
      fallbacks: activeFallbacks,
      highlightReady,
      highlightAfter,
      editActivation,
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
      activeFallbacks,
      highlightReady,
      highlightAfter,
      editActivation,
      preParsedCache,
    ],
  );

  if (!props.variants && !props.components && !activeCode) {
    throw new Errors.ErrorCodeHighlighterClientMissingData();
  }

  // Reset (while the fallback shows) so the validation effect re-checks that
  // ContentLoading wired the hook; the child's `useCodeFallback` effect sets it
  // again before that runs.
  if (showFallback) {
    hookCalledRef.current = false;
  }

  // Provide the generic `CoordinatedFallbackContext` (so a nested CodeHighlighter
  // detects it via `useCoordinatedSwap` and suppresses its own swap, collapsing
  // the fallback→content→fallback→content flicker) alongside the CH-specific
  // fallback context that `useCodeFallback` reads to hoist.
  const fallbackNode = (
    <CoordinatedFallbackContext.Provider value={coordinatedFallbackContext}>
      <CodeHighlighterFallbackContext.Provider value={fallbackContext}>
        {props.fallback}
      </CodeHighlighterFallbackContext.Provider>
    </CoordinatedFallbackContext.Provider>
  );

  // The content subtree. A dynamically-imported content (`LazyContent`) reads the
  // loading `fallback` from `CoordinatedContentContext` and shows it as its own
  // Suspense fallback while its `import()` resolves - so swapping to it never
  // flashes empty.
  const contentNode = (
    <CodeHighlighterContext.Provider value={context}>
      <CoordinatedContentContext.Provider value={contentContext}>
        {props.children}
      </CoordinatedContentContext.Provider>
    </CodeHighlighterContext.Provider>
  );

  // Show the fallback OR the content (swap on data-readiness). The content loads
  // its own chunk after the swap, covered by the fallback it inherits via context.
  return showFallback ? fallbackNode : contentNode;
}
