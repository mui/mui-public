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
import type { CodeEditorLoader } from '../useCode/codeEditorCache';

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
  codeEditorLoader: CodeEditorLoader;
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
   * `() => import(...).then(m => m.createParseSource())` so the highlighting
   * engine (a WebAssembly module) stays out of the initial bundle.
   * Nothing loads until a consumer calls `loadSourceParser`, so there's no
   * first-render penalty.
   */
  createSourceParser: () => Promise<ParseSource>,
): CodeContext {
  const [parseSource, setParseSource] = React.useState<ParseSource | undefined>(undefined);
  const [parseSourceAsync, setParseSourceAsync] = React.useState<ParseSourceAsync | undefined>(
    undefined,
  );
  const [parserRequested, setParserRequested] = React.useState(false);

  // Memoized per provider: the first call starts the load, every later call
  // returns that same promise. Nothing loads until a consumer asks.
  const loadSourceParser = React.useMemo(() => {
    // Only load the highlighter in the browser, not during SSR.
    if (typeof window === 'undefined') {
      return () =>
        Promise.resolve((() => {
          throw new Error('parseSource not available during SSR');
        }) as ParseSource);
    }

    let parser: Promise<ParseSource> | undefined;
    return () => {
      parser ??= createSourceParser();
      setParserRequested(true);
      return parser;
    };
  }, [createSourceParser]);

  React.useEffect(() => {
    if (!parserRequested) {
      return undefined;
    }

    let active = true;
    const publishParser = async () => {
      try {
        const parseSourceFn = await loadSourceParser();
        if (active) {
          setParseSource(() => parseSourceFn);
        }
      } catch (error) {
        // Consumers keep their unhighlighted fallback.
        console.error('Failed to initialize the source parser.', error);
      }
    };
    void publishParser();
    return () => {
      active = false;
    };
  }, [parserRequested, loadSourceParser]);

  // Worker for off-main-thread parsing during live editing. Created LAZILY on the
  // first editable block (via `ensureParseSourceWorker`), not on mount, so a
  // read-only page never spins up the worker or loads the highlighting engine
  // into it. Browser-only; torn down on unmount. The worker client module is
  // dynamically imported so the `new URL('./parseSourceWorker', import.meta.url)`
  // call (which bundlers resolve to a separate worker chunk) never runs in SSR
  // bundles.
  const workerRef = React.useRef<ParseSourceWorkerClient | null>(null);
  const workerPromiseRef = React.useRef<Promise<void> | null>(null);
  const workerCancelledRef = React.useRef(false);

  const ensureParseSourceWorker = React.useCallback(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return Promise.resolve();
    }
    // One worker per provider; concurrent calls share its creation.
    if (workerPromiseRef.current) {
      return workerPromiseRef.current;
    }
    const reset = () => {
      workerPromiseRef.current = null;
    };
    workerPromiseRef.current = (async () => {
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
        reset();
        return;
      }
      workerRef.current = client;
      try {
        await client.init();
      } catch {
        client.terminate();
        workerRef.current = null;
        reset();
        return;
      }
      if (workerCancelledRef.current) {
        client.terminate();
        workerRef.current = null;
        return;
      }
      setParseSourceAsync(() => client.parseSourceAsync);
    })();
    return workerPromiseRef.current;
  }, []);

  React.useEffect(() => {
    workerCancelledRef.current = false;
    return () => {
      workerCancelledRef.current = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      workerPromiseRef.current = null;
    };
  }, []);

  const { loadSource, loadVariantMeta, loadCodeMeta, sourceEnhancers } = props;

  return React.useMemo(() => {
    // `defaultSourceEnhancers` is an input (fills `sourceEnhancers` below), not a
    // context field — destructure it out of the spread.
    const { defaultSourceEnhancers, ...heavyAccessors } = heavy;
    return {
      loadSourceParser,
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
    loadSourceParser,
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
