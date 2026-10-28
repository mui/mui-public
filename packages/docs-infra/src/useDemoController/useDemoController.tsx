'use client';

import * as React from 'react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import type { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';
import { getTranspile } from './transpileClientSingleton';
import { useVariantBuilds } from './useVariantBuilds';
import type { DemoRunnerProps } from './DemoRunner';
import type { Transpile } from './transpileSource';

// The live runtime is loaded LAZILY in two chunks, warmed when a demo activates for
// editing (via `onActivate` below) or, failing that, on the first build:
//   - `BuildEngine` — the build half (`buildScope`) + render half (`DemoRunner` + the
//     react-runner reimplementation), bundled together (see `BuildEngine.ts`).
//   - `compileCss` — the PostCSS toolchain, only needed for demos with CSS files.
// Keeping them out of the eager `useDemoController` chunk means a reader who never edits
// never fetches them. `DemoRunner` is lazy, so the host must render the returned
// `components` under a `Suspense` boundary — `CodeHighlighterClient` does, falling back to
// the build-time render while the chunk resolves (see the `components` return doc).
type BuildEngineModule = { DemoRunner: React.ComponentType<DemoRunnerProps> };
let buildEngineImport: Promise<BuildEngineModule> | null = null;
function preloadBuildEngine(): Promise<BuildEngineModule> {
  if (!buildEngineImport) {
    buildEngineImport = import('./BuildEngine');
  }
  return buildEngineImport;
}
let compileCssImport: Promise<unknown> | null = null;
function preloadCompileCss(): void {
  if (!compileCssImport) {
    compileCssImport = import(/* webpackChunkName: "compileCss" */ './compileCssWithPostcss');
  }
}
const DemoRunner = React.lazy(() =>
  preloadBuildEngine().then((module) => ({ default: module.DemoRunner })),
);

export interface UseDemoControllerResult {
  /** The controlled source, keyed by variant. `null` until editing activates. */
  code: ControlledCode | null;
  /**
   * Updates the controlled source (e.g. as a reader edits a variant). Typed as the
   * context's `setCode` (`Dispatch<SetStateAction>`) so the whole result drops straight
   * into a `CodeControllerContext.Provider` with no cast.
   */
  setCode: NonNullable<CodeControllerContext['setCode']>;
  /**
   * One live preview node per variant, keyed by variant — for the variants that
   * have finished building. `undefined` until at least one is ready, so a host can
   * keep showing its build-time render in the meantime (an in-flight variant simply
   * has no entry). Drop straight into `CodeControllerContext` as `components`.
   *
   * Each node is the lazy `DemoRunner`, so the host MUST render it under a `Suspense`
   * boundary; that boundary's fallback should be the build-time render so a freshly
   * mounted preview (e.g. the first edit after `reset()`) shows the original rather
   * than an empty frame while the chunk resolves. `CodeHighlighterClient` does this.
   */
  components: Record<string, React.ReactNode> | undefined;
  /** Current error message per variant (or `null` when it renders cleanly). */
  errors: Record<string, string | null>;
  /**
   * Warms the lazy live-editing engine chunks when a block activates for editing.
   * Drop straight into `CodeControllerContext` as `onActivate`; the host calls it with
   * which file kinds the demo spans (`js`/`css`).
   */
  onActivate: (deps: { js: boolean; css: boolean }) => void;
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
 * fallback rather than a flash of empty preview. Keeping `code` unset until editing
 * activates lets the host serve its build-time/server render first.
 */
export function useDemoController(): UseDemoControllerResult {
  const [code, setControlledCode] = React.useState<ControlledCode | null>(null);
  // Build errors (transpile/CSS failures) and render errors (the entry throwing) live
  // in SEPARATE maps so they never clobber each other: a build error is owned by
  // `useVariantBuilds` (set on failure, cleared on the next good build); a render
  // error is owned by the live `DemoRunner` (set while it throws, cleared when it
  // renders cleanly). A CSS-only fix doesn't re-render the entry, so the build channel
  // must clear itself rather than wait for the runner. They are merged below.
  const [buildErrors, setBuildErrors] = React.useState<Record<string, string | null>>({});
  const [renderErrors, setRenderErrors] = React.useState<Record<string, string | null>>({});
  const [transpile, setTranspile] = React.useState<Transpile | null>(null);
  const [resetKey, setResetKey] = React.useState(0);
  const activatedRef = React.useRef(false);
  const initialCodeRef = React.useRef<ControlledCode | null>(null);

  const externalsContext = useCodeExternals();
  const externals = React.useMemo(
    () => externalsContext?.externals ?? { react: React },
    [externalsContext],
  );

  // Identity-stable reporters; each dedups a no-op so it doesn't churn state. The
  // `?? null` treats "never set" (undefined) and "cleared" (null) as equal, so
  // clearing a variant that never errored is a no-op.
  const reportBuildError = React.useCallback((variant: string, message: string | null) => {
    setBuildErrors((previous) =>
      (previous[variant] ?? null) === message ? previous : { ...previous, [variant]: message },
    );
  }, []);
  const reportRenderError = React.useCallback((variant: string, message: string | null) => {
    setRenderErrors((previous) =>
      (previous[variant] ?? null) === message ? previous : { ...previous, [variant]: message },
    );
  }, []);

  // Reset (the toolbar button clears `code` to `undefined`) must also drop any stale
  // build/render error, so a prior syntax error's overlay doesn't linger over the
  // restored original — nothing rebuilds after a reset to clear it otherwise. Do it in
  // the setter that performs the reset rather than reacting to the `code` change in an
  // effect; the length guards keep each clear a no-op once its map is empty.
  const setCode = React.useCallback(
    (action: React.SetStateAction<ControlledCode | null> | null) => {
      setControlledCode((previous) => {
        const next = typeof action === 'function' ? action(previous) : action;
        if (next && !initialCodeRef.current) {
          initialCodeRef.current = next;
        }
        return !next && activatedRef.current && initialCodeRef.current
          ? initialCodeRef.current
          : next;
      });
      // Drop stale errors alongside a reset (`code` cleared to `null`).
      if (!action) {
        setBuildErrors({});
        setRenderErrors({});
        if (activatedRef.current && initialCodeRef.current) {
          setResetKey((previous) => previous + 1);
        }
      }
    },
    [setControlledCode],
  );

  // Resolve the page-shared transpile (worker, or main-thread fallback) once there is
  // code to build. `onActivate` has usually already warmed it, but this also covers a
  // controller that receives code before activation. Client-only, so the worker is never
  // built on the server and no `components` render until the client takes over.
  React.useEffect(() => {
    if (!code || transpile) {
      return undefined;
    }
    let active = true;
    getTranspile().then((resolved) => {
      if (active) {
        setTranspile(() => resolved);
      }
    });
    return () => {
      active = false;
    };
  }, [code, transpile]);

  // Warm the lazy engine modules the moment editing ACTIVATES (before the first
  // keystroke), all kicked off here so they download in PARALLEL rather than
  // waterfalling one inside another. The host passes which file kinds the demo spans, so
  // a CSS-free demo never fetches the CSS toolchain and a reader who never activates
  // fetches nothing. (If a host doesn't call this, each still loads on the first build,
  // just a beat later.)
  const onActivate = React.useCallback((deps: { js: boolean; css: boolean }) => {
    activatedRef.current = true;
    // The build + render engine — needed for any demo.
    preloadBuildEngine();
    // The transpile runs in a Web Worker; `getTranspile()` spins it up, loading sucrase
    // OFF the main thread. (A direct `import('./transpileSource')` here would instead
    // pull sucrase INTO the main bundle, defeating the worker.)
    if (deps.js) {
      getTranspile();
    }
    // The PostCSS toolchain — only for demos with CSS.
    if (deps.css) {
      preloadCompileCss();
    }
  }, []);

  const built = useVariantBuilds(code, transpile, externals, reportBuildError, resetKey);

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
      // Render the lazy `DemoRunner` WITHOUT a per-variant Suspense here: the boundary
      // belongs to the HOST, which can fall back to the BUILD-TIME render while the lazy
      // chunk resolves. A `<Suspense fallback={null}>` here paints an empty frame on a
      // NEWLY-MOUNTED boundary — for example, the first live build after activation —
      // flashing blank.
      // Bubbling to the host's boundary shows the original instead.
      result[variant] = (
        <DemoRunner
          key={variant}
          runnerCode={variantBuild.runnerCode}
          scope={variantBuild.scope}
          css={variantBuild.css}
          onError={(message: string | null) => reportRenderError(variant, message)}
        />
      );
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [code, built, reportRenderError]);

  // Merge the two channels: a build failure takes precedence (the preview is stale
  // until it builds), otherwise the render error, else `null`.
  const errors = React.useMemo(() => {
    if (!code) {
      return {};
    }
    const merged: Record<string, string | null> = {};
    for (const variant of new Set([...Object.keys(buildErrors), ...Object.keys(renderErrors)])) {
      merged[variant] = buildErrors[variant] || renderErrors[variant] || null;
    }
    return merged;
  }, [code, buildErrors, renderErrors]);

  return { code, setCode, components, errors, onActivate };
}
