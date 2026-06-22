'use client';

import * as React from 'react';
import type {
  ControlledCode,
  ControlledVariantCode,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
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
 * A variant's FIRST build is never cancelled. On the first edit the controller is
 * seeded with the ORIGINAL source and the real edit follows; if that edit arrives
 * before the seed's build settles, it is DEFERRED (not aborted) so the baseline
 * always builds and renders before the edit lands — giving a broken edit a good
 * preview to fall back to. Later edits abort the in-flight build as usual.
 *
 * Per-variant bookkeeping (request ids, abort controllers, last-built input, the
 * first-build-done set, and the deferred edit) lives in refs since it never
 * affects render; only the resolved `built` map is state.
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
  // The exact input object a variant's latest build was STARTED from (not just
  // resolved). Set when a build begins, so an unrelated re-render can't re-trigger
  // a build of the same in-flight input (the controlled code is immutable, so an
  // unchanged variant keeps its object identity).
  const builtFrom = React.useRef(new Map<string, unknown>());
  // Variants whose FIRST build has settled (resolved or errored). Until then the
  // build is never cancelled; a superseding edit waits in `deferred`.
  const firstBuildDone = React.useRef(new Set<string>());
  const deferred = React.useRef(new Map<string, ControlledVariantCode>());

  React.useEffect(() => {
    if (!code || !transpile) {
      // Controller cleared (e.g. `reset()`): abort in-flight builds and forget all
      // per-variant state, so the next edit is treated as a first build again
      // (re-running the `.original` baseline branch). Drop the resolved `built` map
      // too, so the re-edit starts from an EMPTY map — exactly like a true first
      // edit — instead of briefly flashing the pre-reset build before the rebuilt
      // baseline lands.
      if (!code) {
        for (const controller of controllers.current.values()) {
          controller.abort();
        }
        controllers.current.clear();
        requestIds.current.clear();
        builtFrom.current.clear();
        firstBuildDone.current.clear();
        deferred.current.clear();
        // One-shot reset, NOT a cascading render: `built` is not an effect dep, so
        // clearing it doesn't re-run this effect, and once empty the updater is a
        // no-op. Runs only when `code` is undefined, so it never touches an edit.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on controller clear
        setBuilt((previous) => (Object.keys(previous).length > 0 ? {} : previous));
      }
      return;
    }

    const startBuild = (variant: string, variantCode: ControlledVariantCode) => {
      const { source } = variantCode;
      if (!source) {
        return;
      }
      builtFrom.current.set(variant, variantCode);
      controllers.current.get(variant)?.abort();
      const controller = new AbortController();
      controllers.current.set(variant, controller);
      const requestId = (requestIds.current.get(variant) ?? 0) + 1;
      requestIds.current.set(variant, requestId);

      // After this build settles, build any edit deferred while it ran.
      const buildDeferred = () => {
        const next = deferred.current.get(variant);
        if (next) {
          deferred.current.delete(variant);
          startBuild(variant, next);
        }
      };

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
          firstBuildDone.current.add(variant);
          // The build is now valid — clear any prior build error. A render error (if
          // the entry then throws) is a SEPARATE channel reported by the runner; this
          // only clears the build error, which the runner can't clear itself (a
          // CSS-only fix never re-renders the entry).
          report(variant, null);
          setBuilt((previous) => ({
            ...previous,
            [variant]: {
              runnerCode: result.runnerCode ?? '',
              scope: { import: result.imports },
              css: result.css,
            },
          }));
          buildDeferred();
        })
        .catch((thrown) => {
          if (requestIds.current.get(variant) !== requestId || controller.signal.aborted) {
            return; // superseded / aborted
          }
          // The attempt finished (failed) — later edits may now cancel.
          firstBuildDone.current.add(variant);
          report(variant, thrown instanceof Error ? thrown.message : String(thrown));
          buildDeferred();
        });
    };

    for (const variant of Object.keys(code)) {
      const variantCode = code[variant];
      if (!variantCode || !variantCode.source) {
        continue;
      }
      // First build of a variant that carries a baseline (`.original`, tagged on the
      // FIRST edit): build the ORIGINAL inputs FIRST so the preview shows a good
      // baseline before this (possibly broken) edit, then build the edit (which
      // waits via the defer path below). Gated on `!controllers.has` so it fires
      // exactly once — a re-render or a lingering `.original` never re-baselines.
      const original = variantCode.original;
      if (original?.source && !controllers.current.has(variant)) {
        deferred.current.set(variant, variantCode);
        startBuild(variant, { source: original.source, extraFiles: original.extraFiles });
        continue;
      }
      // Skip a variant whose exact input we already built — so editing one variant
      // doesn't re-transpile and re-evaluate the others.
      if (builtFrom.current.get(variant) === variantCode) {
        continue;
      }
      // Never cancel a variant's FIRST build: while it's in flight, defer this edit
      // (keeping only the latest) instead of aborting, so the baseline renders
      // first. Later edits (first build done) abort the in-flight build as usual.
      if (controllers.current.get(variant) && !firstBuildDone.current.has(variant)) {
        deferred.current.set(variant, variantCode);
        continue;
      }
      startBuild(variant, variantCode);
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
