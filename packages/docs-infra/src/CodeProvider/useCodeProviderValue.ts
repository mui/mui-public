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
import type { EditableEngineLoader } from '../useCode/EditableEngine';

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
  editableEngineLoader: EditableEngineLoader;
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

  // Worker for off-main-thread parsing during live editing. Lazily created
  // once per provider, browser-only, and torn down on unmount. The worker
  // client module is dynamically imported so the `new URL('./parseSourceWorker.ts',
  // import.meta.url)` call (which bundlers resolve to a separate worker chunk)
  // never runs in SSR bundles.
  const workerRef = React.useRef<ParseSourceWorkerClient | null>(null);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return undefined;
    }
    let cancelled = false;
    let client: ParseSourceWorkerClient | undefined;

    Promise.all([
      import('./createParseSourceWorkerClient'),
      // Share the same (lazy) grammar chunk that `createParseSource()` uses,
      // so the heavy TextMate JSON is fetched at most once per page load and
      // then `postMessage`d into the worker.
      import('../pipeline/parseSource/grammars'),
    ])
      .then(([{ createParseSourceWorkerClient }, { grammars }]) => {
        if (cancelled) {
          return;
        }
        // `createParseSourceWorkerClient()` throws synchronously on browsers
        // that expose `Worker` but reject module workers (the typeof gate
        // above can't detect that). Treat the failure as "no async parser
        // available" so consumers transparently fall back to the synchronous
        // highlighter instead of leaving an unhandled rejection on the page.
        try {
          client = createParseSourceWorkerClient();
        } catch {
          return;
        }
        workerRef.current = client;
        client
          .init(grammars)
          .then(() => {
            if (cancelled) {
              return;
            }
            setParseSourceAsync(() => client!.parseSourceAsync);
          })
          .catch(() => {
            // Worker-side init failure (e.g. `createStarryNight` rejected).
            // Tear down so we don't leak the worker, and leave
            // `parseSourceAsync` undefined so consumers fall back to sync.
            if (workerRef.current === client) {
              workerRef.current = null;
            }
            client?.terminate();
            client = undefined;
          });
      })
      .catch(() => {
        // Dynamic-import failure (network error, missing chunk). Same
        // fallback policy: stay on the main-thread highlighter.
      });

    return () => {
      cancelled = true;
      workerRef.current = null;
      client?.terminate();
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
    heavy,
  ]);
}
