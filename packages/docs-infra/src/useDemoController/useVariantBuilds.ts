'use client';

import * as React from 'react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { buildScope } from './buildScope';
import type { Transpile } from './transpileSource';
import type { Scope } from './types';

/** A variant's transpiled, ready-to-render build. */
export interface VariantBuild {
  /** The transpiled entry code for the runner to evaluate. */
  runnerCode: string;
  /** The built module registry the entry evaluates against. */
  scope: Scope;
  /** Compiled stylesheet text for the variant. */
  css: string;
}

/**
 * Builds each variant's scope OFF the main thread and exposes the ready ones. A
 * variant appears in the returned map only once its (worker) transpile resolves —
 * so a host can leave an in-flight variant showing its fallback rather than a
 * loading state. On edit, a variant keeps its previous build until the new one
 * resolves (and on a transpile error too, reported via `report`), so the preview
 * never flashes.
 *
 * Per-variant bookkeeping (request ids, abort controllers, last-built input) lives
 * in refs since it never affects render; only the resolved `built` map is state.
 */
export function useVariantBuilds(
  code: ControlledCode | undefined,
  transpile: Transpile | null,
  externals: Record<string, unknown>,
  report: (variant: string, message: string | null) => void,
): Record<string, VariantBuild> {
  const [built, setBuilt] = React.useState<Record<string, VariantBuild>>({});

  // Per-variant async bookkeeping (render-irrelevant → refs, not state).
  const requestIds = React.useRef(new Map<string, number>());
  const controllers = React.useRef(new Map<string, AbortController>());
  const builtFrom = React.useRef(new Map<string, unknown>());

  React.useEffect(() => {
    if (!code || !transpile) {
      return;
    }
    for (const variant of Object.keys(code)) {
      const variantCode = code[variant];
      const source = variantCode?.source;
      if (!variantCode || !source) {
        continue;
      }
      // Skip a variant whose exact input we already built — so editing one variant
      // doesn't re-transpile and re-evaluate the others.
      if (builtFrom.current.get(variant) === variantCode) {
        continue;
      }
      // Supersede this variant's previous in-flight build.
      controllers.current.get(variant)?.abort();
      const controller = new AbortController();
      controllers.current.set(variant, controller);
      const requestId = (requestIds.current.get(variant) ?? 0) + 1;
      requestIds.current.set(variant, requestId);

      buildScope({
        extraFiles: variantCode.extraFiles,
        externals,
        mainCode: source,
        transpile,
        signal: controller.signal,
      })
        .then((result) => {
          if (requestIds.current.get(variant) !== requestId) {
            return; // superseded by a newer edit
          }
          builtFrom.current.set(variant, variantCode);
          setBuilt((previous) => ({
            ...previous,
            [variant]: {
              runnerCode: result.runnerCode ?? '',
              scope: { import: result.imports },
              css: result.css,
            },
          }));
        })
        .catch((thrown) => {
          if (requestIds.current.get(variant) !== requestId || controller.signal.aborted) {
            return; // superseded / aborted
          }
          // The entry failed to transpile — surface it; the last-good build stays.
          report(variant, thrown instanceof Error ? thrown.message : String(thrown));
        });
    }
  }, [code, transpile, externals, report]);

  // Abort any in-flight builds on unmount.
  React.useEffect(
    () => () => {
      for (const controller of controllers.current.values()) {
        controller.abort();
      }
    },
    [],
  );

  return built;
}
