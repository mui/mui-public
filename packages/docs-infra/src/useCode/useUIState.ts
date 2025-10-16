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
 */
export function useUIState({
  defaultOpen = false,
  mainSlug = '',
}: UseUIStateProps): UseUIStateResult {
  const [hash] = useUrlHashState();

  // Expand if there's a relevant hash or if defaultOpen is true
  const shouldExpandByDefault = React.useMemo(() => {
    if (defaultOpen) {
      return true;
    }
    return isHashRelevantToDemo(hash, mainSlug);
  }, [defaultOpen, hash, mainSlug]);

  const [expanded, setExpanded] = React.useState(shouldExpandByDefault);

  // Update expanded state when hash becomes relevant
  React.useEffect(() => {
    const hasRelevantHash = isHashRelevantToDemo(hash, mainSlug);
    if (hasRelevantHash) {
      setExpanded(true);
    }
  }, [hash, mainSlug]);

  const expand = React.useCallback(() => setExpanded(true), []);

  return {
    expanded,
    expand,
    setExpanded,
  };
}
