'use client';
import * as React from 'react';
import { Code } from './types';

export interface CodeHighlighterContext {
  code?: Code;
  setCode?: React.Dispatch<React.SetStateAction<Code | undefined>>;
  variantName?: string;
  setVariantName?: React.Dispatch<React.SetStateAction<string>>;
}

export const CodeHighlighterContext = React.createContext<CodeHighlighterContext | undefined>(
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
