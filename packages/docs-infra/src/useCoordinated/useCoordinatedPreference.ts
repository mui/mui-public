'use client';
import type * as React from 'react';
import { usePreference } from '../usePreference/usePreference';
import {
  useCoordinated,
  type UseCoordinatedExtras,
  type UseCoordinatedOptions,
} from './useCoordinated';

/**
 * `usePreference` + {@link useCoordinated} in one call.
 *
 * Cross-tab sync happens through the underlying `localStorage` /
 * `storage` event flow that `usePreference` already provides; the
 * coordinator handles within-tab peers so demos that share the same
 * preference key commit their visible flip together rather than
 * cascading layout shifts.
 *
 * @param type - Preference type, identical to `usePreference`.
 * @param name - Variant/transform name(s), identical to
 *   `usePreference`.
 * @param initializer - Initial value or initializer, identical to
 *   `usePreference`.
 * @param options - Coordination options. Pass `channelKey: null` to
 *   skip the coordinator entirely.
 */
export function useCoordinatedPreference<TPreload = void>(
  type: 'variant' | 'transform',
  name: string | string[],
  initializer: string | null | (() => string | null) | undefined,
  options: UseCoordinatedOptions<string | null, TPreload>,
): [
  string | null,
  React.Dispatch<React.SetStateAction<string | null>>,
  UseCoordinatedExtras<string | null>,
] {
  const underlying = usePreference(type, name, initializer ?? null);
  return useCoordinated<string | null, TPreload>(underlying, options);
}
