'use client';
import * as React from 'react';
import { registerLayoutShiftSource } from './layoutShiftGate';

/**
 * Declares the calling component as a source of an initial, post-hydration
 * layout shift — e.g. a code block that swaps from its plain fallback to
 * highlighted (and focus-collapsed) output once it hydrates.
 *
 * While any registered source is unsettled, {@link useCoordinated} holds its
 * layout-shifting commits, so a page-wide transform/variant change lands as a
 * single unified update instead of a cascade as blocks swap in at staggered
 * idle times. The host doesn't wire anything into its coordinated hooks — this
 * registration is the only opt-in.
 *
 * Pass `settled: true` once the component has reached its stable
 * post-hydration layout. Registration happens on mount and is released on
 * unmount, so a component that unmounts before it settles can't hold the gate
 * open for the rest of the page.
 */
export function useCoordinatedLazy(settled: boolean): void {
  const settleRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    settleRef.current = registerLayoutShiftSource();
    return () => {
      // Idempotent — doubles as a release when the component unmounts before
      // it ever settled.
      settleRef.current?.();
      settleRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (settled) {
      settleRef.current?.();
    }
  }, [settled]);
}
