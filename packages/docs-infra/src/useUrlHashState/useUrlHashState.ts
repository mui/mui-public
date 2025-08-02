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

  const [hash, setHashState] = React.useState<string | null>(null);
  const [hasProcessedInitialHash, setHasProcessedInitialHash] = React.useState(false);
  const [hasUserInteraction, setHasUserInteraction] = React.useState(false);

  // Read hash from URL
  const readHash = React.useCallback((): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const currentHash = window.location.hash;
    if (!currentHash) {
      return null;
    }

    return parseHash(currentHash);
  }, [parseHash]);

  // Set hash in URL and state
  const setHash = React.useCallback(
    (value: string | null, replace: boolean = true) => {
      if (typeof window === 'undefined') {
        return;
      }

      const formattedValue = value ? formatHash(value) : '';
      const newUrl = formattedValue
        ? `${window.location.pathname}${window.location.search}#${formattedValue}`
        : `${window.location.pathname}${window.location.search}`;

      // Special case: if value is an empty string (not null), include the hash
      if (value === '') {
        const newUrlWithEmptyHash = `${window.location.pathname}${window.location.search}#`;
        if (replace) {
          window.history.replaceState(null, '', newUrlWithEmptyHash);
        } else {
          window.history.pushState(null, '', newUrlWithEmptyHash);
        }
      } else if (replace) {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }

      setHashState(value);
    },
    [formatHash],
  );

  // Mark user interaction
  const markUserInteraction = React.useCallback(() => {
    setHasUserInteraction(true);
  }, []);

  // Handle hash changes from browser navigation
  const handleHashChange = React.useCallback(() => {
    const newHash = readHash();
    setHashState(newHash);
  }, [readHash]);

  // Read initial hash on mount
  React.useEffect(() => {
    if (!readOnMount || hasProcessedInitialHash) {
      return;
    }

    const initialHash = readHash();
    setHashState(initialHash);
    setHasProcessedInitialHash(true);
  }, [readOnMount, readHash, hasProcessedInitialHash]);

  // Watch for hash changes
  React.useEffect(() => {
    if (!watchChanges || typeof window === 'undefined') {
      return undefined;
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [watchChanges, handleHashChange]);

  return {
    hash,
    setHash,
    hasProcessedInitialHash,
    hasUserInteraction,
    markUserInteraction,
  };
}
