'use client';

import * as React from 'react';
import { CodeContext } from './CodeContext';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import { PreloadProvider } from '../ChunkProvider/PreloadProvider';
import { usePreload } from '../ChunkProvider/usePreload';
import { useCodeProviderValue, type CodeProviderHeavyAccessors } from './useCodeProviderValue';
import {
  PRELOAD_KEY_COMPUTE_DELTAS,
  PRELOAD_KEY_EDITABLE,
  PRELOAD_KEY_LOAD_FALLBACK,
  PRELOAD_KEY_LOAD_VARIANT,
  computeHastDeltasFactory,
  editableEngineFactory,
  loadFallbackFactory,
  loadVariantFactory,
} from './constants';

// Lazy: the Starry Night engine (vscode-textmate + oniguruma) loads with the
// parser on demand instead of shipping in the initial bundle. The consumer
// already awaits `sourceParser`, so this adds no first-render penalty.
const createSourceParserLazy = () =>
  import('../pipeline/parseSource/parseSource').then((mod) => mod.createParseSource());

interface CodeProviderLazyProps {
  /** Child components that will have access to the code handling context */
  children: React.ReactNode;
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  sourceEnhancers?: SourceEnhancers;
}

/**
 * Lazy counterpart to `CodeProvider`: the same context, but the heavy functions
 * (the variant/fallback loaders and the transform-delta computer that pulls
 * `jsondiffpatch`) are loaded via dynamic `import()` on demand instead of bundled.
 * Use this as the general default to keep them out of the initial bundle.
 *
 * It renders its own `PreloadProvider`, so the heavy-chunk fetches dedupe across
 * every code block in its subtree - and `CodeHighlighter`'s first-render
 * speculative preload shares the same promise the eventual consumer resolves -
 * with no extra wiring. (Cross-page network fetches of an identical chunk are
 * deduped by the browser module cache regardless.)
 */
export function CodeProviderLazy({ children, ...rest }: CodeProviderLazyProps) {
  return (
    <PreloadProvider>
      <CodeProviderLazyInner {...rest}>{children}</CodeProviderLazyInner>
    </PreloadProvider>
  );
}

/**
 * Inner provider: lives below the `PreloadProvider` above so its `usePreload`
 * resolves to that provider's dedup cache.
 */
function CodeProviderLazyInner({
  children,
  loadCodeMeta,
  loadVariantMeta,
  loadSource,
  sourceEnhancers,
}: CodeProviderLazyProps) {
  const preload = usePreload();

  const heavy = React.useMemo<CodeProviderHeavyAccessors>(
    () => ({
      loadCodeFallbackLoader: () => preload(PRELOAD_KEY_LOAD_FALLBACK, loadFallbackFactory),
      loadIsomorphicCodeVariantLoader: () => preload(PRELOAD_KEY_LOAD_VARIANT, loadVariantFactory),
      computeHastDeltasLoader: () => preload(PRELOAD_KEY_COMPUTE_DELTAS, computeHastDeltasFactory),
      editableEngineLoader: () => preload(PRELOAD_KEY_EDITABLE, editableEngineFactory),
    }),
    [preload],
  );

  const context = useCodeProviderValue(
    { loadCodeMeta, loadVariantMeta, loadSource, sourceEnhancers },
    heavy,
    createSourceParserLazy,
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
