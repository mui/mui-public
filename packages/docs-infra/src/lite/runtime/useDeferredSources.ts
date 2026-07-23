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
  loadDeferredSources: () => Promise<DeferredSources | null>;
} {
  const [deferredSources, setDeferredSources] = React.useState<DeferredSources | null>(null);
  const deferredUrl = rawCode.deferredUrl;
  const fetchRef = React.useRef<Promise<DeferredSources | null> | null>(null);

  const loadDeferredSources = React.useCallback(async () => {
    if (!deferredUrl) {
      return null;
    }
    if (!fetchRef.current) {
      fetchRef.current = (async () => {
        try {
          const response = await fetch(deferredUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const sources = (await response.json()) as DeferredSources;
          setDeferredSources(sources);
          return sources;
        } catch {
          fetchRef.current = null;
          return null;
        }
      })();
    }
    return fetchRef.current;
  }, [deferredUrl]);

  const code = React.useMemo(
    () => (deferredSources ? mergeDeferredSources(rawCode, deferredSources) : rawCode),
    [rawCode, deferredSources],
  );
  return { code, deferredSources, loadDeferredSources };
}
