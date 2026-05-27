import * as React from 'react';

/**
 * Promise gate shared by `useTransformManagement` and
 * `useVariantSelection` so the `useCoordinated` barrier holds open
 * while the highlighter pipeline (sync `parseCode` + async
 * `computeHastDeltas`) is still in flight. Without this, an
 * originator's click can commit its swap after the normal
 * `transformDelay` / `variantSwapDelay` window even though the
 * incoming HAST hasn't landed yet — the new tree paints from raw
 * source text and snaps to the highlighted version a frame or two
 * later. Routing the gate through the engine's `preload` slot lets
 * the existing barrier machinery (timeouts, peer aggregation,
 * supersession via `AbortSignal`) handle the wait.
 */
type Gate = { promise: Promise<void>; resolve: () => void; resolved: boolean };

function makeGate(): Gate {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn, resolved: false };
}

/**
 * Returns a function that, given an `AbortSignal`, resolves once the
 * highlighter is ready — or returns `null` synchronously when the
 * gate is already open so callers can take a fast path. The returned
 * promise rejects with `AbortError` when the signal aborts so a
 * superseding announce can supersede the wait (the engine silently
 * swallows aborted preload rejections via `coordinatePreference`).
 *
 * The gate is kept in sync with `deferHighlight` from a
 * `React.useEffect`, not during render — refs are mutated only in
 * effects so the linter's `react-hooks/refs` rule stays satisfied.
 * The lag between commit and effect is a single microtask, and the
 * effect runs before any user-initiated click can reach the
 * coordinator, so an originator click that lands in the same
 * microtask as the flip still sees the resolved gate.
 */
export function useHighlightGate(
  deferHighlight: boolean,
): (signal: AbortSignal) => Promise<void> | null {
  const gateRef = React.useRef<Gate | null>(null);
  if (gateRef.current === null) {
    gateRef.current = makeGate();
  }

  React.useEffect(() => {
    const current = gateRef.current;
    if (!deferHighlight) {
      if (current && !current.resolved) {
        current.resolved = true;
        current.resolve();
      }
      return;
    }
    if (current?.resolved) {
      gateRef.current = makeGate();
    }
  }, [deferHighlight]);

  return React.useCallback((signal: AbortSignal): Promise<void> | null => {
    const gate = gateRef.current;
    if (!gate || gate.resolved) {
      return null;
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        reject(new DOMException('Preload aborted', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
      gate.promise.then(() => {
        signal.removeEventListener('abort', onAbort);
        // If abort raced ahead of gate resolution, `onAbort` already
        // rejected this promise; returning without `resolve()` is
        // intentional (settling twice is a no-op, but skipping the
        // call keeps the intent explicit).
        if (signal.aborted) {
          return;
        }
        resolve();
      });
    });
  }, []);
}
