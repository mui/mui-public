import * as React from 'react';

interface UseUIStateProps {
  defaultOpen?: boolean;
}

export interface UseUIStateResult {
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook for managing UI state like expansion and focus
 */
export function useUIState({ defaultOpen = false }: UseUIStateProps): UseUIStateResult {
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const expand = React.useCallback(() => setExpanded(true), []);

  return {
    expanded,
    expand,
    setExpanded,
  };
}
