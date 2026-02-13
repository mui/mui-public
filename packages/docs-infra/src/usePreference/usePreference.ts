'use client';

import * as React from 'react';
import useLocalStorageState from '../useLocalStorageState';
import { usePreferences } from './PreferencesProvider';

const variantPrefPrefix = '_docs_variant_pref';
const transformPref = '_docs_transform_pref';

/**
 * Hook for specialized preference management for code demo variants and transformations.
 * Builds on `useLocalStorageState` with intelligent storage key generation, prefix support,
 * and automatic optimization for single-option scenarios.
 *
 * @param type - Type of preference, affects the storage key prefix
 * @param name - Variant/transform name(s). Arrays are sorted and joined to form the storage key.
 *   Single-element arrays disable persistence (no choice to remember).
 * @param initializer - Initial value or function returning initial value
 * @returns A tuple of [preference, setPreference] for reading and updating the preference
 */
export function usePreference(
  type: 'variant' | 'transform',
  name: string | string[],
  initializer: string | null | (() => string | null) = null,
) {
  const key = React.useMemo(() => {
    if (!Array.isArray(name)) {
      return name;
    }

    if (name.length <= 1) {
      return null; // Don't use localStorage for single variants - no choice to remember
    }

    return [...name].sort().join(':');
  }, [name]);

  const preferences = usePreferences();
  const defaultPrefix = type === 'variant' ? variantPrefPrefix : transformPref;
  const prefix = preferences?.prefix ? `${preferences?.prefix}_${type}` : defaultPrefix;

  const storageKey = key ? `${prefix}:${key}` : null;

  return useLocalStorageState(storageKey, initializer);
}
