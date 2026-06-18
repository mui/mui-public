'use client';

import * as React from 'react';
import { Runner } from './Runner';
import type { RunnerOptions, Scope } from './types';

export interface UseRunnerOptions extends RunnerOptions {
  /**
   * When `true`, the preview clears on error instead of keeping the last
   * successfully-rendered element. Defaults to `false`.
   */
  disableCache?: boolean;
}

export interface UseRunnerResult {
  /** The element to render — a `Runner` instance, or the cached one / `null` on error. */
  element: React.ReactElement | null;
  /** The current error message, or `null` when the code rendered cleanly. */
  error: string | null;
}

/**
 * Runs `code` and returns the element to render plus the current error message.
 *
 * Errors are reported asynchronously (after the runner renders), so the hook
 * keeps the last successfully-rendered element on screen while `error` is set —
 * giving a stable preview as the source is edited into and out of broken states.
 * The error is kept across edits and cleared only once a render succeeds, so a
 * continuously-broken edit never flashes it off and back on. Pass `disableCache`
 * to clear the preview on error instead.
 */
export function useRunner({ code, scope, disableCache }: UseRunnerOptions): UseRunnerResult {
  const lastGoodElementRef = React.useRef<React.ReactElement | null>(null);
  // When an error swaps the preview back to the cached last-good element, that
  // element re-renders cleanly and fires `onRendered` with no error. This flag
  // tells that one "success" NOT to clear the error the swap just set.
  const suppressErrorClearRef = React.useRef(false);

  const [result, setResult] = React.useState<UseRunnerResult>(() => ({
    element: createRunnerElement(code, scope),
    error: null,
  }));

  // Build a fresh live element whenever the inputs change, using React's
  // supported "adjust state during render" pattern so an edit takes effect
  // immediately. The prior error is KEPT here (not reset to null) so a
  // continuously-broken edit doesn't flash the error off and back on; it's
  // cleared only once a render actually succeeds (see `onRendered`).
  const [trackedInputs, setTrackedInputs] = React.useState({ code, scope, disableCache });
  if (
    trackedInputs.code !== code ||
    trackedInputs.scope !== scope ||
    trackedInputs.disableCache !== disableCache
  ) {
    setTrackedInputs({ code, scope, disableCache });
    const element = createRunnerElement(code, scope);
    setResult((previous) => ({ element, error: previous.error }));
  }

  return result;

  // Declared after the state above so it can reference `setResult`; hoisting lets
  // the `useState` initializer call it. The ref is only ever touched inside the
  // async `onRendered` callback, never during render.
  function createRunnerElement(nextCode: string, nextScope: Scope | undefined): React.ReactElement {
    const element: React.ReactElement = React.createElement(Runner, {
      code: nextCode,
      scope: nextScope,
      onRendered(error?: Error) {
        if (error) {
          // Keeping a cached element means it re-renders cleanly next and fires a
          // no-error `onRendered`; mark that one success to be ignored so it
          // doesn't wipe this error. Only when there actually IS a cached element
          // to swap to — with `disableCache`, or before the first successful
          // render, the preview goes to `null` and no such re-render happens, so
          // there is nothing to suppress (and suppressing would eat the real next
          // success).
          if (!disableCache && lastGoodElementRef.current !== null) {
            suppressErrorClearRef.current = true;
          }
          setResult({
            element: disableCache ? null : lastGoodElementRef.current,
            error: error.toString(),
          });
        } else if (suppressErrorClearRef.current) {
          // The cached last-good element re-rendering after an error swap — keep
          // the error, just remember the element.
          suppressErrorClearRef.current = false;
          lastGoodElementRef.current = element;
        } else {
          // A genuine clean render of the current code — cache it and clear any
          // prior error.
          lastGoodElementRef.current = element;
          setResult((previous) =>
            previous.error === null ? previous : { element: previous.element, error: null },
          );
        }
      },
    });
    return element;
  }
}
