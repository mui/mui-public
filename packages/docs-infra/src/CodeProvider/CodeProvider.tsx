'use client';

import * as React from 'react';
import { CodeContext } from './CodeContext';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import type {
  ComputeHastDeltasLoader,
  LoadFallbackCodeLoader,
  LoadVariantLoader,
} from './CodeContext';
import { useCodeProviderValue, type CodeProviderHeavyAccessors } from './useCodeProviderValue';
// Heavy functions: statically imported (eager). They ship in this provider's
// chunk so its accessors resolve instantly with no fetch. Use `CodeProviderLazy`
// to keep them out of the initial bundle instead. (The default emphasis enhancer
// is eager in both providers - see useCodeProviderValue.)
import { createParseSource } from '../pipeline/parseSource/parseSource';
import { loadCodeFallback } from '../pipeline/loadIsomorphicCodeVariant/loadCodeFallback';
import { loadIsomorphicCodeVariant } from '../pipeline/loadIsomorphicCodeVariant/loadIsomorphicCodeVariant';
import { computeHastDeltas } from '../pipeline/loadIsomorphicCodeVariant/computeHastDeltas';

// Eager: the Starry Night engine is bundled, so the parser is created synchronously.
const createSourceParserEager = () => createParseSource();

// Eager accessors: the function is already bundled, so the accessor resolves
// instantly. Module-level so the references are stable across renders.
const loadCodeFallbackLoaderEager: LoadFallbackCodeLoader = () => Promise.resolve(loadCodeFallback);
const loadVariantLoaderEager: LoadVariantLoader = () => Promise.resolve(loadIsomorphicCodeVariant);
const computeHastDeltasLoaderEager: ComputeHastDeltasLoader = () =>
  Promise.resolve(computeHastDeltas);

/**
 * Provides client-side functions for fetching source code and highlighting it.
 * Designed for cases where you need to render code blocks or demos based on
 * client-side state or dynamic content loading.
 *
 * The heavy functions are bundled eagerly here, so they resolve instantly with
 * no fetch - best when a layout will definitely render code. To keep them out of
 * the initial bundle (loaded on demand, deduped across the page), use
 * `CodeProviderLazy` instead.
 */
export function CodeProvider({
  children,
  loadCodeMeta,
  loadVariantMeta,
  loadSource,
  sourceEnhancers,
}: {
  /** Child components that will have access to the code handling context */
  children: React.ReactNode;
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  sourceEnhancers?: SourceEnhancers;
}) {
  const heavy = React.useMemo<CodeProviderHeavyAccessors>(
    () => ({
      loadCodeFallbackLoader: loadCodeFallbackLoaderEager,
      loadIsomorphicCodeVariantLoader: loadVariantLoaderEager,
      computeHastDeltasLoader: computeHastDeltasLoaderEager,
    }),
    [],
  );

  const context = useCodeProviderValue(
    { loadCodeMeta, loadVariantMeta, loadSource, sourceEnhancers },
    heavy,
    createSourceParserEager,
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
