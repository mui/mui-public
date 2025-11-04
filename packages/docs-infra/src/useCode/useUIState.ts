import * as React from 'react';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo } from './useFileNavigation';

interface UseUIStateProps {
  defaultOpen?: boolean;
  mainSlug?: string;
}

export interface UseUIStateResult {
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook for managing UI state like expansion and focus
 * Auto-expands if there's a relevant hash for this demo
 */
export function useUIState({ defaultOpen = false, mainSlug }: UseUIStateProps): UseUIStateResult {
  const [hash] = useUrlHashState();
  const hasRelevantHash = isHashRelevantToDemo(hash, mainSlug);

  const [expanded, setExpanded] = React.useState(defaultOpen || hasRelevantHash);
  const expand = React.useCallback(() => setExpanded(true), []);

  // Auto-expand if hash becomes relevant
  React.useEffect(() => {
    if (hasRelevantHash && !expanded) {
      setExpanded(true);
    }
  }, [hasRelevantHash, expanded]);

  return {
    expanded,
    expand,
    setExpanded,
  };
}
