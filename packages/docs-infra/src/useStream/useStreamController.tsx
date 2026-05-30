'use client';

import * as React from 'react';
import { createSettleGate } from '../useCoordinated/createSettleGate';
import { CoordinatedGateContext } from '../CoordinatedLazy/CoordinatedGateContext';
import type { UseStreamControllerOptions, UseStreamControllerResult } from './types';

/**
 * Scope a group of chunks so the page can tell when they have all loaded.
 *
 * Returns a `Controller` provider to wrap the chunks in - it supplies the
 * controller's gate as the ambient gate (via `CoordinatedGateContext`), so
 * chunks rendered inside register their swap with it through `CoordinatedLazy`
 * without a `gate` prop - and a reactive `loading` flag that stays `true` until
 * every registered chunk settles. Completion resolves via the gate's
 * **known-count** (`knownCount`) or **last-chunk** (`streaming` + `markLast`)
 * signals; with neither, it opens as soon as the chunks present in the initial
 * commit all settle. Each chunk also registers with the page-global gate (via
 * `CoordinatedLazy`), so a page-wide coordinated commit waits for them too.
 */
export function useStreamController(
  options: UseStreamControllerOptions = {},
): UseStreamControllerResult {
  const { knownCount, streaming = false, safetyTimeoutMs } = options;

  // One gate per controller instance, configured once with its completion mode.
  const [gate] = React.useState(() => {
    const instance = createSettleGate(safetyTimeoutMs != null ? { safetyTimeoutMs } : undefined);
    if (knownCount != null) {
      instance.expect(knownCount);
    } else if (streaming) {
      // Hold open for an unknown-count stream until markLast.
      instance.expect(Number.POSITIVE_INFINITY);
    }
    return instance;
  });

  // Stable provider that hands this instance's gate down as the ambient gate
  // (created once; `gate` is stable for the controller's lifetime).
  const [Controller] = React.useState(
    () =>
      function StreamControllerProvider({ children }: { children: React.ReactNode }) {
        return (
          <CoordinatedGateContext.Provider value={gate}>{children}</CoordinatedGateContext.Provider>
        );
      },
  );

  const [loading, setLoading] = React.useState(() => knownCount !== 0);

  React.useEffect(() => {
    // Chunks register in their own (child) effects, which run before this
    // (parent) effect - so by now the gate reflects every chunk present in the
    // initial commit.
    if (gate.isSettled()) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    let cancelled = false;
    const wait = gate.whenSettled();
    if (wait) {
      wait
        .then(() => {
          if (!cancelled) {
            setLoading(false);
          }
        })
        .catch(() => {});
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [gate]);

  const markLast = React.useCallback(() => gate.markLast(), [gate]);
  const setKnownCount = React.useCallback((count: number) => gate.expect(count), [gate]);

  return { Controller, loading, gate, markLast, setKnownCount };
}
