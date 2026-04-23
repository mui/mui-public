'use client';
import * as React from 'react';
import { Code, ControlledCode, Fallbacks } from './types';
import { Selection } from '../CodeControllerContext';

export interface CodeHighlighterContextType {
  code?: Code;
  setCode?: React.Dispatch<React.SetStateAction<ControlledCode | undefined>>;
  selection?: Selection;
  setSelection?: React.Dispatch<React.SetStateAction<Selection>>;
  components?: Record<string, React.ReactNode>;
  availableTransforms?: string[];
  url?: string;
  deferHighlight?: boolean;
  /**
   * Compact fallback data for the active variant, keyed by fileName.
   * Used by `Pre` to both render the fallback and derive text dictionaries
   * for decompressing `hastCompressed` payloads.
   */
  fallbacks?: Fallbacks;
}

export const CodeHighlighterContext = React.createContext<CodeHighlighterContextType | undefined>(
  undefined,
);

export function useCodeHighlighterContext() {
  const context = React.useContext(CodeHighlighterContext);
  if (context === undefined) {
    throw new Error(
      'CodeHighlighterContext is missing. `useCodeHighlighterContext` must be used within a `CodeHighlighter` component.',
    );
  }
  return context;
}

export function useCodeHighlighterContextOptional() {
  return React.useContext(CodeHighlighterContext);
}
