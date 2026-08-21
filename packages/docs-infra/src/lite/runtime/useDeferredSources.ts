'use client';

import * as React from 'react';
import type { CodePrecompute, DeferredSources, VariantCode, VariantExtraFile } from './types';

interface RenderableExtraFile extends VariantExtraFile {
  html?: string;
}

type RenderableVariant = Omit<VariantCode, 'extraFiles'> & {
  extraFiles?: Record<string, RenderableExtraFile>;
};

type RenderableCode = Omit<CodePrecompute, 'variants'> & {
  variants: Record<string, RenderableVariant>;
};

interface DeferredState {
  url: string | undefined;
  sources: DeferredSources | null;
  error: Error | null;
}

interface DeferredRequest {
  url: string;
  promise: Promise<DeferredSources | null>;
}

function mergeDeferredSources(code: CodePrecompute, deferred: DeferredSources): RenderableCode {
  const variants: Record<string, RenderableVariant> = {};
  for (const [variantName, variant] of Object.entries(code.variants)) {
    const deferredVariant = deferred[variantName];
    variants[variantName] = {
      ...variant,
      ...(deferredVariant?.source !== undefined ? { html: deferredVariant.source } : {}),
      ...(variant.extraFiles
        ? {
            extraFiles: Object.fromEntries(
              Object.entries(variant.extraFiles).map(([fileName, file]) => [
                fileName,
                {
                  ...file,
                  ...(deferredVariant?.extraFiles?.[fileName] !== undefined
                    ? { html: deferredVariant.extraFiles[fileName] }
                    : {}),
                },
              ]),
            ),
          }
        : {}),
    };
  }
  return { ...code, variants };
}

/** Fetches and merges deferred highlighted markup on first use. */
export function useDeferredSources(rawCode: CodePrecompute): {
  code: RenderableCode;
  deferredSources: DeferredSources | null;
  deferredSourcesError: Error | null;
  loadDeferredSources: () => Promise<DeferredSources | null>;
} {
  const deferredUrl = rawCode.deferredUrl;
  const [state, setState] = React.useState<DeferredState>({
    url: deferredUrl,
    sources: null,
    error: null,
  });
  const requestRef = React.useRef<DeferredRequest | null>(null);
  const deferredSources = state.url === deferredUrl ? state.sources : null;
  const deferredSourcesError = state.url === deferredUrl ? state.error : null;

  const loadDeferredSources = React.useCallback(async () => {
    if (!deferredUrl) {
      return null;
    }
    if (requestRef.current?.url === deferredUrl) {
      return requestRef.current.promise;
    }

    setState({ url: deferredUrl, sources: null, error: null });
    const request: DeferredRequest = {
      url: deferredUrl,
      promise: Promise.resolve(null),
    };
    requestRef.current = request;
    request.promise = (async () => {
      try {
        const response = await fetch(deferredUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const sources = (await response.json()) as DeferredSources;
        if (requestRef.current !== request) {
          return null;
        }
        setState({ url: deferredUrl, sources, error: null });
        return sources;
      } catch (error) {
        if (requestRef.current !== request) {
          return null;
        }
        requestRef.current = null;
        setState({
          url: deferredUrl,
          sources: null,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return null;
      }
    })();
    return request.promise;
  }, [deferredUrl]);

  const code = React.useMemo(
    () => (deferredSources ? mergeDeferredSources(rawCode, deferredSources) : rawCode),
    [rawCode, deferredSources],
  );
  return {
    code,
    deferredSources,
    deferredSourcesError,
    loadDeferredSources,
  };
}
