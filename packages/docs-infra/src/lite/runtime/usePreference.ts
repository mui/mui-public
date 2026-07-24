'use client';

import * as React from 'react';

/** Remembers shared demo/code preferences while remaining SSR-safe. */
export function usePreference(
  type: 'variant' | 'transform',
  name: string | string[],
  initializer: string | null | (() => string | null) = null,
): [string | null, (value: string | null) => void] {
  const key = React.useMemo(() => {
    if (Array.isArray(name)) {
      return name.length > 1 ? [...name].sort().join(':') : null;
    }
    return name;
  }, [name]);
  const storageKey = key === null ? null : `_docs_${type}_pref:${key}`;
  const [value, setValue] = React.useState<string | null>(() =>
    typeof initializer === 'function' ? initializer() : initializer,
  );

  React.useEffect(() => {
    if (storageKey === null) {
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after hydration
      setValue(stored);
    }
  }, [storageKey]);

  const setPreference = React.useCallback(
    (next: string | null) => {
      setValue(next);
      if (storageKey !== null) {
        try {
          if (next === null) {
            window.localStorage.removeItem(storageKey);
          } else {
            window.localStorage.setItem(storageKey, next);
          }
        } catch {
          // Keep the in-memory value when storage is unavailable.
        }
      }
    },
    [storageKey],
  );
  return [value, setPreference];
}
