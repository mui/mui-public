'use client';
import * as React from 'react';

export interface UseUrlHashStateOptions {
  /**
   * Whether to automatically read the hash on mount
   * @default true
   */
  readOnMount?: boolean;

  /**
   * Whether to automatically watch for hash changes
   * @default true
   */
  watchChanges?: boolean;

  /**
   * Custom hash parser function
   * @default (hash) => hash.slice(1) // Remove the '#'
   */
  parseHash?: (hash: string) => string;

  /**
   * Custom hash formatter function
   * @default (value) => value
   */
  formatHash?: (value: string) => string;
}

export interface UseUrlHashStateResult {
  /**
   * Current hash value (without the '#')
   */
  hash: string | null;

  /**
   * Set a new hash value (will update the URL)
   * @param value - New hash value
   * @param replace - Whether to use replaceState instead of pushState
   */
  setHash: (value: string | null, replace?: boolean) => void;

  /**
   * Whether the initial hash has been processed
   */
  hasProcessedInitialHash: boolean;

  /**
   * Whether the user has explicitly interacted with the hash
   */
  hasUserInteraction: boolean;

  /**
   * Mark that user has interacted with the hash
   */
  markUserInteraction: () => void;
}

const defaultParseHash = (hash: string): string => hash.slice(1); // Remove the '#'
const defaultFormatHash = (value: string): string => value;

/**
 * Hook for managing URL hash state with SSR support
 */
export function useUrlHashState(options: UseUrlHashStateOptions = {}): UseUrlHashStateResult {
  const {
    readOnMount = true,
    watchChanges = true,
    parseHash = defaultParseHash,
    formatHash = defaultFormatHash,
  } = options;

  const [hasUserInteraction, setHasUserInteraction] = React.useState(false);

  // Store the subscriber callback so we can trigger it manually
  const subscriberRef = React.useRef<(() => void) | null>(null);

  // Subscribe to hash changes
  const subscribe = React.useCallback(
    (callback: () => void) => {
      subscriberRef.current = callback;
      if (!watchChanges || typeof window === 'undefined') {
        return () => {
          subscriberRef.current = null;
        };
      }
      window.addEventListener('hashchange', callback);
      return () => {
        window.removeEventListener('hashchange', callback);
        subscriberRef.current = null;
      };
    },
    [watchChanges],
  );

  // Get current hash value (client-side)
  const getSnapshot = React.useCallback((): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    const currentHash = window.location.hash;
    if (!currentHash) {
      return null;
    }
    return parseHash(currentHash);
  }, [parseHash]);

  // Get server snapshot (always null for SSR)
  const getServerSnapshot = React.useCallback((): null => null, []);

  // Use useSyncExternalStore for hash synchronization
  const urlHashState = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Track if initial hash has been processed (true when readOnMount is true, false when readOnMount is false)
  const hasProcessedInitialHash = readOnMount;

  // Determine the hash value based on readOnMount option
  const hash = readOnMount ? urlHashState : null;

  // Set hash in URL and state
  const setHash = React.useCallback(
    (value: string | null, replace: boolean = true) => {
      if (typeof window === 'undefined') {
        return;
      }

      const formattedValue = value ? formatHash(value) : '';
      let newUrl = formattedValue
        ? `${window.location.pathname}${window.location.search}#${formattedValue}`
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
    },
    [formatHash],
  );

  // Mark user interaction
  const markUserInteraction = React.useCallback(() => {
    setHasUserInteraction(true);
  }, []);

  return {
    hash,
    setHash,
    hasProcessedInitialHash,
    hasUserInteraction,
    markUserInteraction,
  };
}
