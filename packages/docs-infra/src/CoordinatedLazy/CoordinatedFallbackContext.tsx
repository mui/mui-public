'use client';

import * as React from 'react';
import type { CoordinatedFallbackContextValue } from './types';

/**
 * Provided by a `CoordinatedLazy` to its fallback subtree while the fallback is
 * shown. Carries the upward hoist channel and the nested-suppression flag.
 *
 * `undefined` outside a fallback subtree: a fallback reads it via
 * `useCoordinatedFallback`, and a nested `CoordinatedLazy` detects its presence
 * to know it is rendered inside an outer instance's still-loading fallback.
 */
export const CoordinatedFallbackContext = React.createContext<
  CoordinatedFallbackContextValue | undefined
>(undefined);
