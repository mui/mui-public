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
import { useCodeProviderValue } from './useCodeProviderValue';
import type { CodeProviderHeavyAccessors } from './useCodeProviderValue';
import { ensureGrammars, preloadAllGrammars } from '../pipeline/parseSource/grammarCache';
import { normalizeToScopes } from '../pipeline/parseSource/grammarMaps';
// Lazy wrapper for the emphasis enhancer: keeps its ~13 KB chunk out of this
// provider's initial bundle, loading it only when a block actually enhances.
import { enhanceCodeEmphasisLazy } from '../pipeline/enhanceCodeEmphasis/enhanceCodeEmphasisLazy';
import {
  PRELOAD_KEY_COMPUTE_DELTAS,
  PRELOAD_KEY_CODE_EDITOR,
  PRELOAD_KEY_LOAD_FALLBACK,
  PRELOAD_KEY_LOAD_VARIANT,
  PRELOAD_KEY_TRANSFORM_ENGINE,
  computeHastDeltasFactory,
  codeEditorFactory,
  loadFallbackFactory,
  loadVariantFactory,
  transformEngineFactory,
} from './constants';

// Lazy: the highlighting engine (one WebAssembly module with every supported
// language) loads with the parser on demand instead of shipping in the initial
// bundle. Blocks also request it via `ensureGrammars` (driven by
// `CodeHighlighter`'s speculative preload + readiness gate). Nothing loads until
// a consumer calls `loadSourceParser` or a block needs highlighting, so this
// adds no first-render penalty.
const createSourceParserLazy = () =>
  import('../pipeline/parseSource/parseSource').then((mod) => mod.createParseSource([]));

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
  /**
   * Load the highlighting engine on mount instead of when the first block
   * needs it. Pass a list of language names (`'tsx'`, `'css'`) or scope names
   * (`'source.tsx'`), or `'all'`. The engine includes every supported language
   * (~150&nbsp;KB gzip), so any value loads the same module. Useful for a layout
   * that knows it will render code. Omit it (the default) to load the engine
   * only when a block highlights.
   */
  preloadGrammars?: 'all' | string[];
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
  preloadGrammars,
}: CodeProviderLazyProps) {
  const preload = usePreload();

  // Optional provider-level grammar warm-up. Default (omitted) stays fully lazy:
  // each block loads only the grammars it needs, on demand. Fails open.
  const preloadGrammarsKey = Array.isArray(preloadGrammars)
    ? preloadGrammars.join('\n')
    : preloadGrammars;
  React.useEffect(() => {
    if (!preloadGrammars) {
      return;
    }
    if (preloadGrammars === 'all') {
      preloadAllGrammars().catch(() => {});
    } else {
      ensureGrammars(normalizeToScopes(preloadGrammars)).catch(() => {});
    }
    // `preloadGrammarsKey` captures the array contents so a new-but-equal array
    // prop doesn't re-run; `ensureGrammars` is idempotent regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadGrammarsKey]);

  const heavy = React.useMemo<CodeProviderHeavyAccessors>(
    () => ({
      loadCodeFallbackLoader: () => preload(PRELOAD_KEY_LOAD_FALLBACK, loadFallbackFactory),
      loadIsomorphicCodeVariantLoader: () => preload(PRELOAD_KEY_LOAD_VARIANT, loadVariantFactory),
      computeHastDeltasLoader: () => preload(PRELOAD_KEY_COMPUTE_DELTAS, computeHastDeltasFactory),
      codeEditorLoader: () => preload(PRELOAD_KEY_CODE_EDITOR, codeEditorFactory),
      transformEngineLoader: () => preload(PRELOAD_KEY_TRANSFORM_ENGINE, transformEngineFactory),
      defaultSourceEnhancers: [enhanceCodeEmphasisLazy],
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
