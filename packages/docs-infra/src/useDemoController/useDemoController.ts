'use client';

import * as React from 'react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';
import { getTranspile } from './transpileClientSingleton';
import { useVariantBuilds } from './useVariantBuilds';
import { DemoRunner } from './DemoRunner';
import type { Transpile } from './transpileSource';

export interface UseDemoControllerResult {
  /** The controlled source, keyed by variant. `undefined` until the first edit. */
  code: ControlledCode | undefined;
  /** Updates the controlled source (e.g. as a reader edits a variant). */
  setCode: React.Dispatch<React.SetStateAction<ControlledCode | undefined>>;
  /**
   * One live preview node per variant, keyed by variant — for the variants that
   * have finished building. `undefined` until at least one is ready, so a host can
   * keep showing its build-time render in the meantime (an in-flight variant simply
   * has no entry). Drop straight into `CodeControllerContext` as `components`.
   */
  components: Record<string, React.ReactNode> | undefined;
  /** Current error message per variant (or `null` when it renders cleanly). */
  errors: Record<string, string | null>;
}

/**
 * Drives the live previews for a demo controller. Owns the controlled `code` state,
 * transpiles each variant OFF the main thread (via a shared Web Worker, with a
 * main-thread fallback) and renders the ready ones through {@link DemoRunner}, and
 * collects the per-variant `errors` — returning exactly the `{ code, setCode,
 * components, errors }` shape a `CodeControllerContext` provider expects, so a host
 * wires it up in one line and reads results back through `useDemo`.
 *
 * Because transpilation is async, a variant joins `components` only once its build
 * resolves; editing never blocks the UI thread, and an in-flight variant shows its
 * fallback rather than a flash of empty preview. Keeping `code` unset until the
 * first `setCode` lets the host serve its build-time/server render first.
 */
export function useDemoController(): UseDemoControllerResult {
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);
  const [errors, setErrors] = React.useState<Record<string, string | null>>({});
  const [transpile, setTranspile] = React.useState<Transpile | null>(null);

  const externalsContext = useCodeExternals();
  const externals = React.useMemo(
    () => externalsContext?.externals ?? { react: React },
    [externalsContext],
  );

  // Identity-stable so the `components` map only rebuilds when `code`/`built` change,
  // and a no-op report (same message) doesn't trigger a needless state update.
  const report = React.useCallback((variant: string, message: string | null) => {
    setErrors((previous) =>
      previous[variant] === message ? previous : { ...previous, [variant]: message },
    );
  }, []);

  // Resolve the page-shared transpile (worker, or main-thread fallback) once, in a
  // browser effect — never during SSR, so the worker is never built on the server
  // and the controller renders with no `components` until the client takes over.
  React.useEffect(() => {
    let active = true;
    getTranspile().then((resolved) => {
      if (active) {
        setTranspile(() => resolved);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const built = useVariantBuilds(code, transpile, externals, report);

  const components = React.useMemo(() => {
    if (!code) {
      return undefined;
    }
    const result: Record<string, React.ReactNode> = {};
    for (const variant of Object.keys(code)) {
      const variantBuild = built[variant];
      if (!variantBuild) {
        continue; // first build still in flight — no component yet
      }
      result[variant] = React.createElement(DemoRunner, {
        key: variant,
        runnerCode: variantBuild.runnerCode,
        scope: variantBuild.scope,
        css: variantBuild.css,
        onError: (message: string | null) => report(variant, message),
      });
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [code, built, report]);

  return { code, setCode, components, errors };
}
