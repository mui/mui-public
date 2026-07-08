'use client';

import * as React from 'react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';
import { useCrossTabState } from '@mui/internal-docs-infra/useCrossTabState';
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

export interface UseDemoControllerOptions {
  /**
   * Keep the controlled code in sync across same-origin tabs/windows of the same page
   * (e.g. a Chrome split view) via a `BroadcastChannel`. On by default; pass `false`
   * to opt a demo out. SSR-safe — the channel only opens in the browser.
   */
  crossTabSync?: boolean;
  /**
   * The demo's source url (`import.meta.url`) — the demo factory passes it through, so
   * a `DemoController` can forward its props straight to this hook. Used as the
   * per-demo `crossTabSync` key (the page path scopes it further) so each demo syncs
   * only with its counterpart in the other tab. Without it, sync falls back to
   * page-level — correct only when the page has a single demo.
   */
  url?: string;
}

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
 * fallback rather than a flash of empty preview. Keeping `code` unset until the
 * first `setCode` lets the host serve its build-time/server render first.
 *
 * By default the controlled code is also mirrored across same-origin tabs of the same
 * page (via the `crossTabSync` option), so a reader editing a demo in a Chrome split
 * view sees it update in both panes.
 */
export function useDemoController(options: UseDemoControllerOptions = {}): UseDemoControllerResult {
  const { crossTabSync = true, url } = options;
  // The controlled code, owned here and mirrored across same-origin tabs of this page.
  // The channel name combines the page path with the per-demo `url`, so split-view tabs
  // of one page sync each demo independently; `null` (disabled, or on the server) opens
  // no channel and `useCrossTabState` behaves like a plain `useState`.
  const syncChannel = React.useMemo(() => {
    if (!crossTabSync || typeof window === 'undefined') {
      return null;
    }
    return `mui-docs-infra:demo-controller:${window.location.pathname}\u0000${url ?? ''}`;
  }, [crossTabSync, url]);
  const [code, setCode] = useCrossTabState<ControlledCode | undefined>(syncChannel, undefined);
  // Build errors (transpile/CSS failures) and render errors (the entry throwing) live
  // in SEPARATE maps so they never clobber each other: a build error is owned by
  // `useVariantBuilds` (set on failure, cleared on the next good build); a render
  // error is owned by the live `DemoRunner` (set while it throws, cleared when it
  // renders cleanly). A CSS-only fix doesn't re-render the entry, so the build channel
  // must clear itself rather than wait for the runner. They are merged below.
  const [buildErrors, setBuildErrors] = React.useState<Record<string, string | null>>({});
  const [renderErrors, setRenderErrors] = React.useState<Record<string, string | null>>({});
  const [transpile, setTranspile] = React.useState<Transpile | null>(null);

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
  // restored original — nothing rebuilds after a reset to clear it otherwise. The
  // length guards keep this a no-op once the maps are empty.
  React.useEffect(() => {
    if (code) {
      return;
    }
    // One-shot reset on controller clear (the length guards make it a no-op once
    // empty), NOT a cascading render — mirrors `useVariantBuilds`' `setBuilt` reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on controller clear
    setBuildErrors((previous) => (Object.keys(previous).length > 0 ? {} : previous));
    setRenderErrors((previous) => (Object.keys(previous).length > 0 ? {} : previous));
  }, [code]);

  // Resolve the page-shared transpile (worker, or main-thread fallback) into state once
  // there's code to build — a local first edit, or a cross-tab edit that arrives without
  // this tab engaging its own editor. `onActivate` below has usually already spun the
  // worker up (so `getTranspile()` here resolves from cache), but this covers the
  // passive/synced tab that never activates. Client-only, so the worker is never built
  // on the server and the controller renders with no `components` until the client takes
  // over.
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

  const built = useVariantBuilds(code, transpile, externals, reportBuildError);

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
      // NEWLY-MOUNTED boundary — the first edit after `reset()`, where `built` was cleared
      // so no prior live frame exists for `startTransition` to hold — flashing blank.
      // Bubbling to the host's boundary shows the original instead.
      result[variant] = React.createElement(DemoRunner, {
        key: variant,
        runnerCode: variantBuild.runnerCode,
        scope: variantBuild.scope,
        css: variantBuild.css,
        onError: (message: string | null) => reportRenderError(variant, message),
      });
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [code, built, reportRenderError]);

  // Merge the two channels: a build failure takes precedence (the preview is stale
  // until it builds), otherwise the render error, else `null`.
  const errors = React.useMemo(() => {
    const merged: Record<string, string | null> = {};
    for (const variant of new Set([...Object.keys(buildErrors), ...Object.keys(renderErrors)])) {
      merged[variant] = buildErrors[variant] || renderErrors[variant] || null;
    }
    return merged;
  }, [buildErrors, renderErrors]);

  return { code, setCode, components, errors, onActivate };
}
