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

  // Track the previous `deferHighlight` value so the rAF/IO settle
  // wait below only applies on the true → false *transition*. On the
  // initial mount with `deferHighlight` already false, the gate
  // resolves synchronously — there was no pending pipeline to wait
  // on, so no IO catch-up is needed.
  const prevDeferRef = React.useRef<boolean | undefined>(undefined);

  React.useEffect(() => {
    const current = gateRef.current;
    const prev = prevDeferRef.current;
    prevDeferRef.current = deferHighlight;
    if (!deferHighlight) {
      if (!current || current.resolved) {
        return undefined;
      }
      if (prev !== true) {
        // First settle (mount with `deferHighlight: false`, or any
        // path where we never observed a `true`): release
        // synchronously — there was no in-flight highlight pass
        // whose IO follow-up we'd be waiting on.
        current.resolved = true;
        current.resolve();
        return undefined;
      }
      // Wait one paint frame past the highlight pipeline's
      // completion before opening the gate. `deferHighlight`
      // flips false the moment `parseCode` (and, when applicable,
      // `computeHastDeltas`) resolves — i.e. when the focus-aware
      // HAST exists. But the rendered `<Pre>` instances still
      // need an IntersectionObserver tick to mark their visible
      // frames as such; until that tick lands, frames outside the
      // focused region paint as plain fallback text. Without the
      // rAF + macrotask wait below, an interactive variant /
      // transform swap can commit on the same frame the parse
      // resolves, and the incoming tree paints its non-focused
      // frames as raw text for one cycle before the IO callback
      // upgrades them. The setTimeout(0) drains any IO callbacks
      // already queued by the prior render; the rAF gives the
      // browser a paint cycle so the updated `visibleFrames` set
      // commits before the host kicks off the layout-shift
      // animation. Mirrors the IO-settle wait that
      // `Pre.tsx`'s `onTransitionReady` path uses on the other
      // side of the swap.
      let rafId: number | null = null;
      const release = () => {
        if (current.resolved) {
          return;
        }
        current.resolved = true;
        current.resolve();
      };
      if (typeof requestAnimationFrame !== 'function') {
        release();
        return undefined;
      }
      const taskId = setTimeout(() => {
        rafId = requestAnimationFrame(release);
      }, 0);
      return () => {
        clearTimeout(taskId);
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
      };
    }
    if (current?.resolved) {
      gateRef.current = makeGate();
    }
    return undefined;
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
