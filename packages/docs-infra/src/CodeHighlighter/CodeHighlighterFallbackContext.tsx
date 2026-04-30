'use client';
import * as React from 'react';
import type { Fallbacks, ContentLoadingVariant } from './types';

export interface CodeHighlighterFallbackContext {
  extraVariants?: Record<string, ContentLoadingVariant>;
  /**
   * Callback used by `useCodeFallback` to hoist fallback data
   * back to `CodeHighlighterClient` so it can derive text dictionaries
   * for decompressing `hastCompressed` payloads.
   */
  setFallbackHasts?: (variantName: string, hasts: Fallbacks) => void;
  /**
   * Callback invoked by `useCodeFallback` in an effect to signal that
   * the hook was used. Allows the parent to detect when a ContentLoading
   * component forgets to call the hook.
   */
  onHookCalled?: () => void;
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
