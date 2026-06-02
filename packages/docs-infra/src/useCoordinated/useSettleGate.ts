'use client';

import * as React from 'react';
import type { SettleGate } from './createSettleGate';
import { pageSettleGate } from './pageSettleGate';

/**
 * Register the calling component as a source on a settle gate and release it
 * once `settled` is `true`. Generalizes `useCoordinatedLazy`: registration
 * happens on mount and the release is idempotent, so a component that unmounts
 * before settling can't hold the gate open. Defaults to the page-global
 * {@link pageSettleGate}; pass `null` to opt out of registration entirely (used
 * when a swap conditionally registers with a controller gate that may be
 * absent).
 */
export function useSettleGate(settled: boolean, gate: SettleGate | null = pageSettleGate): void {
  const settleRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!gate) {
      return undefined;
    }
    settleRef.current = gate.register();
    return () => {
      // Idempotent - doubles as a release when the component unmounts before it
      // ever settled, so it can't hold the gate open for the rest of the page.
      settleRef.current?.();
      settleRef.current = null;
    };
  }, [gate]);

  React.useEffect(() => {
    if (settled) {
      settleRef.current?.();
    }
  }, [settled]);
}
