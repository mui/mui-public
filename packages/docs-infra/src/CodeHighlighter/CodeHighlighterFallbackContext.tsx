'use client';
import * as React from 'react';
import { ContentLoadingVariant } from './types';

export interface CodeHighlighterFallbackContext extends ContentLoadingVariant {
  extraVariants?: Record<string, ContentLoadingVariant>;
}

export const CodeHighlighterFallbackContext = React.createContext<
  CodeHighlighterFallbackContext | undefined
>(undefined);

export function useCodeHighlighterFallbackContext() {
  const context = React.useContext(CodeHighlighterFallbackContext);
  if (context === undefined) {
    throw new Error(
      'CodeHighlighterFallbackContext is missing. `useCodeHighlighterFallbackContext` must be used within a `CodeHighlighter` component.',
    );
  }
  return context;
}
