import * as React from 'react';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo } from './useFileNavigation';

interface UseUIStateProps {
  initialExpanded?: boolean;
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
export function useUIState({
  initialExpanded = false,
  mainSlug,
}: UseUIStateProps): UseUIStateResult {
  const [hash] = useUrlHashState();
  const hasRelevantHash = isHashRelevantToDemo(hash, mainSlug);

  const [expanded, setExpanded] = React.useState(initialExpanded || hasRelevantHash);
  const expand = React.useCallback(() => setExpanded(true), []);

  // Auto-expand if hash becomes relevant. This is a one-way OR-latch: it ratchets
  // `expanded` to true but never collapses, so adjusting state during render is safe
  // (the branch is skipped once `expanded` is true, avoiding an extra render).
  if (hasRelevantHash && !expanded) {
    setExpanded(true);
  }

  return {
    expanded,
    expand,
    setExpanded,
  };
}
