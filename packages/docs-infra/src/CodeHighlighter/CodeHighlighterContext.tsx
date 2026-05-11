'use client';
import * as React from 'react';
import { type Code, type ControlledCode, type Fallbacks, type HastRoot } from './types';
import { type Selection } from '../CodeControllerContext';

/**
 * One cached pre-parsed file. Stored per-fileName: each new write replaces
 * any previous entry for that file. The `source` string is the cache key —
 * `parseControlledCode` only reuses `hast` when the controlled-code source
 * is byte-identical, which guarantees the cached HAST matches the input
 * that produced it.
 */
export interface PreParsedCacheEntry {
  source: string;
  hast: HastRoot;
}

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
  /**
   * Per-file pre-parsed HAST cache. Populated by `useSourceEditing` when the
   * editable supplies a worker-parsed result alongside a source change, and
   * read by `parseControlledCode` to skip the (sync, main-thread) parse on
   * exact source matches. Owned by `CodeHighlighterClient` via `useRef` so
   * the same `Map` instance is shared across render cycles without being a
   * React dep.
   */
  preParsedCache?: Map<string, PreParsedCacheEntry>;
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
