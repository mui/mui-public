'use client';
import * as React from 'react';

/**
 * Hook for managing URL hash state with SSR support
 * @returns A tuple of [hash, setHash] where hash is the current URL hash (without '#') and setHash updates it
 */
export function useUrlHashState(): [
  string | null,
  (value: string | null, replace?: boolean) => void,
] {
  // Store the subscriber callback so we can trigger it manually
  const subscriberRef = React.useRef<(() => void) | null>(null);

  // Subscribe to hash changes
  const subscribe = React.useCallback((callback: () => void) => {
    subscriberRef.current = callback;
    if (typeof window === 'undefined') {
      return () => {
        subscriberRef.current = null;
      };
    }
    window.addEventListener('hashchange', callback);
    return () => {
      window.removeEventListener('hashchange', callback);
      subscriberRef.current = null;
    };
  }, []);

  // Get current hash value (client-side)
  const getSnapshot = React.useCallback((): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    const currentHash = window.location.hash;
    if (!currentHash) {
      return null;
    }
    return currentHash.slice(1); // Remove the '#'
  }, []);

  // Get server snapshot (always null for SSR)
  const getServerSnapshot = React.useCallback((): null => null, []);

  // Use useSyncExternalStore for hash synchronization
  const hash = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Set hash in URL and state
  const setHash = React.useCallback((value: string | null, replace: boolean = true) => {
    let newUrl = value
      ? `${window.location.pathname}${window.location.search}#${value}`
      : `${window.location.pathname}${window.location.search}`;
    // Special case: if value is an empty string (not null), include the hash
    if (value === '') {
      newUrl = `${window.location.pathname}${window.location.search}#`;
    }

    if (replace) {
      window.history.replaceState(null, '', newUrl);
    } else {
      window.history.pushState(null, '', newUrl);
    }

    // Trigger the subscriber to update useSyncExternalStore
    if (subscriberRef.current) {
      subscriberRef.current();
    }
  }, []);

  return [hash, setHash];
}
