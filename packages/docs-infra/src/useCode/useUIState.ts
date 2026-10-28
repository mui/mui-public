import * as React from 'react';
import { useUrlHashState } from '../useUrlHashState';
import { isHashRelevantToDemo } from './useFileNavigation';

interface UseUIStateProps {
  initialExpanded?: boolean;
  initialDisabled?: boolean;
  mainSlug?: string;
  onExpand?: () => void;
}

export interface UseUIStateResult {
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  editable: boolean;
  setEditable: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook for managing UI state like expansion and focus
 * Auto-expands if there's a relevant hash for this demo
 */
export function useUIState({
  initialExpanded = false,
  initialDisabled = false,
  mainSlug,
  onExpand,
}: UseUIStateProps): UseUIStateResult {
  const [hash] = useUrlHashState();
  const hasRelevantHash = isHashRelevantToDemo(hash, mainSlug);

  const [expanded, setExpanded] = React.useState(initialExpanded || hasRelevantHash);
  const expand = React.useCallback(() => setExpanded(true), []);

  // Edit-mode toggle. Starts on unless the block opted into `initialDisabled`; the host
  // exposes `setEditable` (gated on a controller) so a reader can flip read-only ↔ edit.
  const [editable, setEditable] = React.useState(!initialDisabled);

  if (hasRelevantHash && !expanded && !onExpand) {
    setExpanded(true);
  }

  // Route post-mount deep links through the host's expansion policy. An initially
  // relevant hash is already represented by the state initializer above.
  React.useEffect(() => {
    if (hasRelevantHash && !expanded && onExpand) {
      onExpand();
    }
  }, [expanded, hasRelevantHash, onExpand]);

  return {
    expanded,
    expand,
    setExpanded,
    editable,
    setEditable,
  };
}
