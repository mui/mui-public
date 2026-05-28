import * as React from 'react';

/**
 * Four-state paused→active animation phase shared by
 * `useTransformManagement` and `useVariantSelection`. Each swap
 * window enters a "paused" value first (`'collapsed'` pre-swap or
 * `'expanded'` post-swap) so the rendered `<Pre>` can settle into
 * the animation start state; the host then advances to the matching
 * active value (`'expanding'` / `'collapsing'`) once readiness fires.
 */
export type TransitionPhase = 'collapsed' | 'expanding' | 'expanded' | 'collapsing' | null;

/**
 * Tracks the paused→active handshake for a single phase source.
 *
 * `windowKey` is an opaque identifier the caller composes from
 * whatever uniquely identifies the current swap window (typically
 * `(from, to, postSwap)`). The readiness flag is keyed against it so
 * every new window starts with a fresh wait — `notify()` only marks
 * the current window ready, and a subsequent window flip
 * automatically falls back to "not ready" without any explicit
 * reset.
 */
export function useTransitionPhase(windowKey: string): {
  ready: boolean;
  notify: () => void;
} {
  const [state, setState] = React.useState<{ key: string; ready: boolean }>({
    key: windowKey,
    ready: false,
  });
  // React's recommended pattern for resetting state when an input
  // changes: a guarded `setState` during render. This guarantees
  // each new window starts at not-ready, even if the same key value
  // recurs along an unusual swap path.
  if (state.key !== windowKey) {
    setState({ key: windowKey, ready: false });
  }
  const ready = state.key === windowKey && state.ready;
  const notify = React.useCallback(() => {
    setState((prev) => (prev.key === windowKey ? { key: windowKey, ready: true } : prev));
  }, [windowKey]);
  return { ready, notify };
}
