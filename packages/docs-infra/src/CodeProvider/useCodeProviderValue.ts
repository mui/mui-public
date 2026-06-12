'use client';

import * as React from 'react';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import { parseCode } from '../pipeline/loadIsomorphicCodeVariant/parseCode';
import { parseControlledCode } from '../CodeHighlighter/parseControlledCode';
import type { ParseSourceAsync, ParseSourceWorkerClient } from './createParseSourceWorkerClient';
import type {
  CodeContext,
  ComputeHastDeltasLoader,
  LoadFallbackCodeLoader,
  LoadVariantLoader,
  TransformEngineLoader,
} from './CodeContext';
import type { EditingEngineLoader } from '../useCode/editingEngineCache';

/**
 * The host-supplied source loaders. Identical for both providers (passed by the
 * consumer), so they live on the base props.
 */
export interface CodeProviderBaseProps {
  /** Function to load code metadata from a URL */
  loadCodeMeta?: LoadCodeMeta;
  /** Function to load specific variant metadata */
  loadVariantMeta?: LoadVariantMeta;
  /** Function to load raw source code and dependencies */
  loadSource?: LoadSource;
  /** Explicit source enhancers; defaults to the eager emphasis enhancer. */
  sourceEnhancers?: SourceEnhancers;
}

/**
 * Heavy-function provisioning supplied by a *specific* provider. The eager
 * `CodeProvider` passes accessors that resolve instantly to statically-bundled
 * functions; `CodeProviderLazy` passes accessors backed by dynamic `import()`.
 * Keeping these out of {@link useCodeProviderValue} is what lets the bundler keep
 * the heavy modules out of the lazy provider's chunk.
 */
export interface CodeProviderHeavyAccessors {
  loadCodeFallbackLoader: LoadFallbackCodeLoader;
  loadIsomorphicCodeVariantLoader: LoadVariantLoader;
  computeHastDeltasLoader: ComputeHastDeltasLoader;
  editingEngineLoader: EditingEngineLoader;
  transformEngineLoader: TransformEngineLoader;
  /**
   * Provider-specific default source enhancers. The eager `CodeProvider` passes
   * the bundled `enhanceCodeEmphasis` (zero-fetch); `CodeProviderLazy` passes the
   * lazy wrapper so the ~13 KB emphasis chunk stays out of its initial bundle.
   */
  defaultSourceEnhancers: SourceEnhancers;
}

/**
 * Builds the {@link CodeContext} value shared by `CodeProvider` and
 * `CodeProviderLazy`: the (browser-only, lazily-initialized) source parser, the
 * worker-backed async parser for live editing, the eager synchronous parsers,
 * and the host loaders - plus whichever heavy-function accessors the provider
 * supplied. This hook never statically imports the heavy loaders.
 */
export function useCodeProviderValue(
  props: CodeProviderBaseProps,
  heavy: CodeProviderHeavyAccessors,
  /**
   * Provider-supplied source-parser creator. Eager `CodeProvider` passes a
   * static `() => createParseSource()`; `CodeProviderLazy` passes a dynamic
   * `() => import(...).then(m => m.createParseSource())` so the Starry Night
   * regex engine (vscode-textmate + oniguruma) stays out of the initial bundle.
   * Either way the consumer already awaits `sourceParser`, so there's no new
   * first-render penalty.
   */
  createSourceParser: () => Promise<ParseSource>,
): CodeContext {
  const [parseSource, setParseSource] = React.useState<ParseSource | undefined>(undefined);
  const [parseSourceAsync, setParseSourceAsync] = React.useState<ParseSourceAsync | undefined>(
    undefined,
  );

  const sourceParser = React.useMemo(() => {
    // Only initialize Starry Night in the browser, not during SSR
    if (typeof window === 'undefined') {
      return Promise.resolve((() => {
        throw new Error('parseSource not available during SSR');
      }) as ParseSource);
    }

    return createSourceParser();
  }, [createSourceParser]);

  React.useEffect(() => {
    // Update the sync version when available
    sourceParser.then((parseSourceFn) => setParseSource(() => parseSourceFn));
  }, [sourceParser]);

  // Worker for off-main-thread parsing during live editing. Created LAZILY on the
  // first editable block (via `ensureParseSourceWorker`), not on mount, and
  // initialized with only that block's grammar scopes — so a read-only page never
  // spins up the worker or downloads grammar JSON for it. Browser-only; torn down
  // on unmount. The worker client module is dynamically imported so the
  // `new URL('./parseSourceWorker', import.meta.url)` call (which bundlers resolve
  // to a separate worker chunk) never runs in SSR bundles.
  const workerRef = React.useRef<ParseSourceWorkerClient | null>(null);
  const workerSentScopesRef = React.useRef<Set<string>>(new Set());
  const workerChainRef = React.useRef<Promise<void>>(Promise.resolve());
  const workerCancelledRef = React.useRef(false);

  const ensureParseSourceWorker = React.useCallback((scopes: string[]) => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return;
    }
    const needed = scopes.filter((scope) => !workerSentScopesRef.current.has(scope));
    if (needed.length === 0) {
      return;
    }
    // Optimistically mark as sent; the serialized chain below does the actual
    // send in order. Rolled back if the load/init/register fails.
    needed.forEach((scope) => workerSentScopesRef.current.add(scope));
    const rollback = () => needed.forEach((scope) => workerSentScopesRef.current.delete(scope));

    // Serialize create/register so an early init completes before a later
    // register, and concurrent calls never double-create the worker.
    workerChainRef.current = workerChainRef.current.then(async () => {
      if (workerCancelledRef.current) {
        return;
      }

      // Share the per-scope grammar chunks the main thread uses; the bytes are
      // postMessage'd into the worker so each grammar is fetched at most once.
      let grammars;
      try {
        const { grammarLoaders } = await import('../pipeline/parseSource/grammarLoaders');
        grammars = (await Promise.all(needed.map((scope) => grammarLoaders[scope]?.()))).filter(
          (grammar): grammar is NonNullable<typeof grammar> => grammar != null,
        );
      } catch {
        rollback();
        return;
      }
      if (workerCancelledRef.current) {
        return;
      }

      // Worker already exists — add the new grammars to it.
      const existing = workerRef.current;
      if (existing) {
        try {
          await existing.register(grammars);
        } catch {
          rollback();
        }
        return;
      }

      // First editable block — create the worker and initialize it.
      let client: ParseSourceWorkerClient;
      try {
        const { createParseSourceWorkerClient } = await import('./createParseSourceWorkerClient');
        if (workerCancelledRef.current) {
          return;
        }
        // Throws synchronously where `Worker` exists but module workers are
        // rejected — fall back to the synchronous highlighter.
        client = createParseSourceWorkerClient();
      } catch {
        rollback();
        return;
      }
      workerRef.current = client;
      try {
        await client.init(grammars);
      } catch {
        client.terminate();
        workerRef.current = null;
        rollback();
        return;
      }
      if (workerCancelledRef.current) {
        client.terminate();
        workerRef.current = null;
        return;
      }
      setParseSourceAsync(() => client.parseSourceAsync);
    });
  }, []);

  React.useEffect(() => {
    workerCancelledRef.current = false;
    return () => {
      workerCancelledRef.current = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      workerSentScopesRef.current = new Set();
    };
  }, []);

  const { loadSource, loadVariantMeta, loadCodeMeta, sourceEnhancers } = props;

  return React.useMemo(() => {
    // `defaultSourceEnhancers` is an input (fills `sourceEnhancers` below), not a
    // context field — destructure it out of the spread.
    const { defaultSourceEnhancers, ...heavyAccessors } = heavy;
    return {
      sourceParser,
      parseSource, // Sync version when available
      parseSourceAsync, // Worker-backed async version when available
      loadSource,
      loadVariantMeta,
      loadCodeMeta,
      // Default emphasis enhancer. Eager provider supplies the bundled enhancer;
      // the lazy provider supplies a wrapper that defers the chunk until a block
      // actually enhances (skipped entirely for precomputed HAST).
      sourceEnhancers: sourceEnhancers ?? defaultSourceEnhancers,
      // Eager synchronous parsers (small; on the sync render path).
      parseCode,
      parseControlledCode,
      // Lazily spins up the live-editing worker with a block's grammar scopes.
      ensureParseSourceWorker,
      // Provider-specific heavy-function provisioning (eager or lazy).
      ...heavyAccessors,
    };
  }, [
    sourceParser,
    parseSource,
    parseSourceAsync,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    sourceEnhancers,
    ensureParseSourceWorker,
    heavy,
  ]);
}
