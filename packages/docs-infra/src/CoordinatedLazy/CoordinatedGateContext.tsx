'use client';

import * as React from 'react';
import type { SettleGate } from '../useCoordinated/createSettleGate';

/**
 * The ambient settle gate that a {@link CoordinatedLazy} swap registers with
 * when it isn't given an explicit `gate` prop. A coordinator (e.g. the
 * `useStream` controller) provides its gate here so every swap rendered beneath
 * it reports into the same gate - that is how a group's `loading` reflects each
 * piece's swap without threading a `gate` prop through every one. `null` outside
 * any coordinator, in which case the swap registers only with the page-global
 * gate.
 */
export const CoordinatedGateContext = React.createContext<SettleGate | null>(null);

/** Read the ambient settle gate, or `null` when there is no surrounding coordinator. */
export function useCoordinatedGate(): SettleGate | null {
  return React.useContext(CoordinatedGateContext);
}
