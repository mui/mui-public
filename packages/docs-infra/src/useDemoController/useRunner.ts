'use client';

import * as React from 'react';
import { Runner } from './Runner';
import type { Scope } from './types';

export interface UseRunnerOptions {
  /** Already-transpiled entry code to evaluate + render (see {@link Runner}). */
  transpiledCode: string;
  /** Identifiers (and an `import` registry) exposed to the evaluated entry. */
  scope?: Scope;
  /**
   * When `true`, the preview clears on error instead of keeping the last
   * successfully-rendered element. Defaults to `false`.
   */
  disableCache?: boolean;
  /**
   * Shown when the entry throws on a render BEFORE any successful one (so there is no
   * last-good element to keep) — typically the host's build-time render, so a broken first
   * edit shows the original instead of blanking. Ignored once a render has succeeded (the
   * last-good element is kept instead) and when `disableCache` is set.
   */
  fallback?: React.ReactNode;
}

export interface UseRunnerResult {
  /** The node to render — a `Runner`, the cached last-good one, the `fallback`, or `null`. */
  element: React.ReactNode;
  /** The current error message, or `null` when the code rendered cleanly. */
  error: string | null;
}

interface RunnerHookState {
  element: React.ReactNode;
  error: string | null;
  /** The exact inputs the current `element` was built from (compared by reference). */
  transpiledCode: string;
  scope: Scope | undefined;
  disableCache: boolean | undefined;
}

/**
 * Evaluates already-transpiled entry code and returns the element to render plus
 * the current error message. Transpilation happens upstream (off the main thread);
 * this hook owns only the synchronous evaluate + render + error bookkeeping.
 *
 * Errors are reported asynchronously (after the runner renders), so the hook keeps
 * the last successfully-rendered element on screen while `error` is set — giving a
 * stable preview as the source is edited into and out of broken states. The error
 * is kept across edits and cleared only once a render succeeds, so a continuously-
 * broken edit never flashes it off and back on. Pass `disableCache` to clear the
 * preview on error instead.
 *
 * The live element and the inputs it was built from live in a SINGLE state object,
 * not two `useState` hooks. The "adjust state during render" pattern issues a
 * render-phase update; with the inputs and element split across two hooks, React
 * could commit the input update while dropping the element one (e.g. when a parent
 * re-render rebases the in-progress render), stranding a stale element that the
 * adjust never rebuilt because the inputs already matched. Keeping them together
 * makes the update atomic: if it is dropped, the inputs revert with it and the
 * adjust simply re-fires on the next render.
 */
export function useRunner({
  transpiledCode,
  scope,
  disableCache,
  fallback,
}: UseRunnerOptions): UseRunnerResult {
  const lastGoodElementRef = React.useRef<React.ReactElement | null>(null);
  // When an error swaps the preview back to the cached last-good element, that
  // element re-renders cleanly and fires `onRendered` with no error. This flag
  // tells that one "success" NOT to clear the error the swap just set.
  const suppressErrorClearRef = React.useRef(false);

  const [state, setState] = React.useState<RunnerHookState>(() => ({
    element: createRunnerElement(transpiledCode, scope),
    error: null,
    transpiledCode,
    scope,
    disableCache,
  }));

  // Build a fresh live element whenever the inputs change, using React's supported
  // "adjust state during render" pattern so an edit takes effect immediately. The
  // prior error is KEPT here (not reset to null) so a continuously-broken edit
  // doesn't flash the error off and back on; it's cleared only once a render
  // actually succeeds (see `onRendered`).
  if (
    state.transpiledCode !== transpiledCode ||
    state.scope !== scope ||
    state.disableCache !== disableCache
  ) {
    const element = createRunnerElement(transpiledCode, scope);
    setState((previous) => ({
      element,
      error: previous.error,
      transpiledCode,
      scope,
      disableCache,
    }));
  }

  return { element: state.element, error: state.error };

  // Declared after the state above so it can reference `setState`; hoisting lets
  // the `useState` initializer call it. The refs are only ever touched inside the
  // async `onRendered` callback, never during render.
  function createRunnerElement(nextCode: string, nextScope: Scope | undefined): React.ReactElement {
    const element: React.ReactElement = React.createElement(Runner, {
      transpiledCode: nextCode,
      scope: nextScope,
      onRendered(error?: Error) {
        if (error) {
          // Keeping a cached element means it re-renders cleanly next and fires a
          // no-error `onRendered`; mark that one success to be ignored so it
          // doesn't wipe this error. Only when there actually IS a cached element
          // to swap to — with `disableCache`, or before the first successful
          // render, the preview falls back to `fallback`/`null` and no such
          // re-render happens, so there is nothing to suppress (and suppressing
          // would eat the real next success).
          if (!disableCache && lastGoodElementRef.current !== null) {
            suppressErrorClearRef.current = true;
          }
          setState((previous) => ({
            ...previous,
            // Before any successful render there is no last-good element to keep, so show the
            // host's build-time `fallback` (the original) rather than blanking. `disableCache`
            // opts out and clears to `null`.
            element: disableCache ? null : (lastGoodElementRef.current ?? fallback ?? null),
            error: error.toString(),
          }));
        } else if (suppressErrorClearRef.current) {
          // The cached last-good element re-rendering after an error swap — keep
          // the error, just remember the element.
          suppressErrorClearRef.current = false;
          lastGoodElementRef.current = element;
        } else {
          // A genuine clean render of the current code — cache it and clear any
          // prior error.
          lastGoodElementRef.current = element;
          setState((previous) =>
            previous.error === null ? previous : { ...previous, error: null },
          );
        }
      },
    });
    return element;
  }
}
