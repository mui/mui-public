// highlight context
import * as React from 'react';
import type { Nodes as HastNode } from 'hast';

export const HighlightContext = React.createContext<
  ((code: string, language: string) => Promise<HastNode>) | null
>(null);
export const useHighlight = () => {
  const context = React.useContext(HighlightContext);

  if (!context) {
    throw new Error('useHighlight must be used within a HighlightProvider');
  }

  return context;
};
