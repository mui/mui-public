'use client';

import * as React from 'react';
import { CodeContext } from './CodeContext';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { createParseSource } from '../pipeline/parseSource/parseSource';
import type { ParseSourceAsync, ParseSourceWorkerClient } from './createParseSourceWorkerClient';
// Import the heavy functions
import { loadCodeFallback } from '../pipeline/loadCodeVariant/loadCodeFallback';
import { loadCodeVariant } from '../pipeline/loadCodeVariant/loadCodeVariant';
import { parseCode } from '../pipeline/loadCodeVariant/parseCode';
import { parseControlledCode } from '../CodeHighlighter/parseControlledCode';
import {
  computeHastDeltas,
  getAvailableTransforms,
} from '../pipeline/loadCodeVariant/computeHastDeltas';

const DEFAULT_SOURCE_ENHANCERS: SourceEnhancers = [enhanceCodeEmphasis];

/**
 * Provides client-side functions for fetching source code and highlighting it.
 * Designed for cases where you need to render code blocks or demos based on
 * client-side state or dynamic content loading.
 *
 * Implements the Props Context Layering pattern by providing heavy functions
 * via context that can't be serialized across the server-client boundary.
 */
export function CodeProvider({
  children,
  loadCodeMeta,
  loadVariantMeta,
  loadSource,
  sourceEnhancers = DEFAULT_SOURCE_ENHANCERS,
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

    return createParseSource();
  }, []);

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

  const context = React.useMemo(
    () => ({
      sourceParser,
      parseSource, // Sync version when available
      parseSourceAsync, // Worker-backed async version when available
      loadSource,
      loadVariantMeta,
      loadCodeMeta,
      sourceEnhancers,
      // Provide the heavy functions
      loadCodeFallback,
      loadCodeVariant,
      parseCode,
      parseControlledCode,
      computeHastDeltas,
      getAvailableTransforms,
    }),
    [
      sourceParser,
      parseSource,
      parseSourceAsync,
      loadSource,
      loadVariantMeta,
      loadCodeMeta,
      sourceEnhancers,
    ],
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
