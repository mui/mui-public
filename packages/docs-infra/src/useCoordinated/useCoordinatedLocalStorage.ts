'use client';
import type * as React from 'react';
import useLocalStorageState from '../useLocalStorageState';
import { useCoordinated } from './useCoordinated';
import type { UseCoordinatedExtras, UseCoordinatedOptions } from './useCoordinated';

/**
 * `useLocalStorageState` + coordination in one call. Cross-tab sync
 * happens via the underlying storage events; the coordinator handles
 * within-tab peers (sibling demos on the same page) so their visible
 * value flips land in a single layout pass.
 *
 * @param storageKey - localStorage key, or `null` to disable storage
 *   (falls back to regular `useState` semantics).
 * @param initializer - Initial value, identical to
 *   `useLocalStorageState`.
 * @param options - Coordination options. Pass `channelKey: null` to
 *   skip the coordinator entirely.
 */
export function useCoordinatedLocalStorage<TPreload = void>(
  storageKey: string | null,
  initializer: string | null | (() => string | null),
  options: UseCoordinatedOptions<string | null, TPreload>,
): [
  string | null,
  React.Dispatch<React.SetStateAction<string | null>>,
  UseCoordinatedExtras<string | null>,
] {
  const underlying = useLocalStorageState(storageKey, initializer) as [
    string | null,
    React.Dispatch<React.SetStateAction<string | null>>,
  ];
  return useCoordinated<string | null, TPreload>(underlying, options);
}
