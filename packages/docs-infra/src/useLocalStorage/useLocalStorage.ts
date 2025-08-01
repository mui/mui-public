import * as React from 'react';

// Cross-tab synchronization: event emitter for same-tab changes
const currentTabChangeListeners = new Map<string, Set<() => void>>();

function onCurrentTabStorageChange(key: string, handler: () => void) {
  let listeners = currentTabChangeListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    currentTabChangeListeners.set(key, listeners);
  }
  listeners.add(handler);
}

function offCurrentTabStorageChange(key: string, handler: () => void) {
  const listeners = currentTabChangeListeners.get(key);
  if (!listeners) {
    return;
  }

  listeners.delete(handler);
  if (listeners.size === 0) {
    currentTabChangeListeners.delete(key);
  }
}

function emitCurrentTabStorageChange(key: string) {
  const listeners = currentTabChangeListeners.get(key);
  if (listeners) {
    listeners.forEach((listener) => listener());
  }
}

function subscribe(key: string | null, callback: () => void): () => void {
  if (!key || typeof window === 'undefined') {
    return () => {};
  }

  const storageHandler = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === key) {
      callback();
    }
  };

  window.addEventListener('storage', storageHandler);
  onCurrentTabStorageChange(key, callback);

  return () => {
    window.removeEventListener('storage', storageHandler);
    offCurrentTabStorageChange(key, callback);
  };
}

function getStorageSnapshot(key: string | null): string | null {
  if (!key || typeof window === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(key: string | null, value: string | null) {
  if (!key || typeof window === 'undefined') {
    return;
  }
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    emitCurrentTabStorageChange(key);
  } catch {
    // Ignore localStorage errors (private browsing, quota exceeded, etc.)
  }
}

interface UseLocalStorageOptions<T> {
  /** Initial value to use if localStorage is empty or unavailable */
  initialValue: T;
  /** Custom storage key. If null, localStorage won't be used */
  storageKey: string | null;
  /** Skip initial sync from localStorage (e.g., when an explicit initial value is provided) */
  skipInitialSync?: boolean;
  /** Custom serializer for storing complex values */
  serialize?: (value: T) => string;
  /** Custom deserializer for reading complex values */
  deserialize?: (value: string) => T | null;
  /** Custom validator to check if a deserialized value is valid */
  isValidValue?: (value: T) => boolean;
}

export interface UseLocalStorageResult<T> {
  /** Current value */
  value: T;
  /** Function to update the value (will automatically sync to localStorage) */
  setValue: (value: React.SetStateAction<T>) => void;
  /** Function to update the value and mark it as a user selection (for automatic localStorage sync) */
  setValueAsUserSelection: (value: React.SetStateAction<T>) => void;
  /** Whether the value has been synced from localStorage */
  hasSynced: boolean;
}

/**
 * Hook for managing state with localStorage persistence
 * Handles hydration, error handling, and user selection tracking
 */
export function useLocalStorage<T>({
  initialValue,
  storageKey,
  skipInitialSync = false,
  serialize = (value) => JSON.stringify(value),
  deserialize = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
  isValidValue = () => true,
}: UseLocalStorageOptions<T>): UseLocalStorageResult<T> {
  const [value, setValue] = React.useState<T>(initialValue);

  // Track if the user has made an explicit selection change
  const hasUserSelection = React.useRef(false);
  // Track the last value we set to prevent sync loops
  const lastSetValue = React.useRef<T>(initialValue);
  // Track the last raw value we processed to prevent processing the same value twice
  const lastProcessedRawValue = React.useRef<string | null>(null);

  // Cross-tab synchronization with useSyncExternalStore
  const subscribeToStorage = React.useCallback(
    (callback: () => void) => subscribe(storageKey, callback),
    [storageKey],
  );

  const getStorageValue = React.useCallback(() => {
    if (!storageKey || skipInitialSync) {
      return null;
    }
    return getStorageSnapshot(storageKey);
  }, [storageKey, skipInitialSync]);

  const getServerStorageValue = () => null; // Always null on server

  const storedRawValue = React.useSyncExternalStore(
    subscribeToStorage,
    getStorageValue,
    getServerStorageValue,
  );

  // Sync from localStorage when storedRawValue changes (but avoid loops)
  React.useEffect(() => {
    if (
      storedRawValue !== null &&
      !skipInitialSync &&
      storedRawValue !== lastProcessedRawValue.current
    ) {
      const deserializedValue = deserialize(storedRawValue);
      if (deserializedValue !== null && isValidValue(deserializedValue)) {
        lastProcessedRawValue.current = storedRawValue;
        lastSetValue.current = deserializedValue;
        setValue(deserializedValue);
      }
    }
  }, [storedRawValue, skipInitialSync, deserialize, isValidValue]);

  // Save to localStorage only when user makes explicit selection changes
  React.useEffect(() => {
    if (!hasUserSelection.current || !storageKey || typeof window === 'undefined') {
      return;
    }

    const serializedValue = serialize(value);
    lastProcessedRawValue.current = serializedValue;
    setStorageValue(storageKey, serializedValue);
  }, [value, storageKey, serialize]);

  // Regular setValue function (doesn't trigger localStorage save)
  const setValueWrapper = React.useCallback(
    (newValue: React.SetStateAction<T>) => {
      const resolvedValue =
        typeof newValue === 'function' ? (newValue as (prev: T) => T)(value) : newValue;

      // Update with resolved value if valid, otherwise fall back to initial value
      if (isValidValue(resolvedValue)) {
        // Reset user selection flag - this is a programmatic update, not user-driven
        hasUserSelection.current = false;
        lastSetValue.current = resolvedValue;
        setValue(resolvedValue);
      } else {
        // Reset user selection flag when falling back to initial value
        hasUserSelection.current = false;
        lastSetValue.current = initialValue;
        setValue(initialValue);
      }
    },
    [value, isValidValue, initialValue],
  );

  // setValue function that marks as user selection (triggers localStorage save)
  const setValueAsUserSelection = React.useCallback(
    (newValue: React.SetStateAction<T>) => {
      const resolvedValue =
        typeof newValue === 'function' ? (newValue as (prev: T) => T)(value) : newValue;

      // Update with resolved value if valid, otherwise fall back to initial value
      if (isValidValue(resolvedValue)) {
        hasUserSelection.current = true;
        lastSetValue.current = resolvedValue;
        setValue(resolvedValue);
      } else {
        hasUserSelection.current = true;
        lastSetValue.current = initialValue;
        setValue(initialValue);
      }
    },
    [value, isValidValue, initialValue],
  );

  return {
    value,
    setValue: setValueWrapper,
    setValueAsUserSelection,
    hasSynced: skipInitialSync || storageKey === null || typeof window !== 'undefined',
  };
}
