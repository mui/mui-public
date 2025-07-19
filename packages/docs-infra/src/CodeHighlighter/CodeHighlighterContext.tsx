'use client';
import * as React from 'react';
import { Code, ControlledCode } from './types';
import { Selection } from '../CodeControllerContext';

export interface CodeHighlighterContextType {
  code?: Code;
  setCode?: React.Dispatch<React.SetStateAction<ControlledCode | undefined>>;
  selection?: Selection;
  setSelection?: React.Dispatch<React.SetStateAction<Selection>>;
  components?: Record<string, React.ReactNode>;
  // Transform utilities
  availableTransforms?: string[];
  selectedTransform?: string | null;
  setSelectedTransform?: React.Dispatch<React.SetStateAction<string | null>>;
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
