'use client';
import * as React from 'react';
import { type Code, type ControlledCode, type HastRoot } from './types';
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
   * Render-side readiness gate. `true` once the highlight trigger
   * (`init` / `hydration` / `idle` / `visible`) has fired *and* the
   * sync `parseCode` pass has resolved, so consumers like `<Pre>`
   * can render the published `code` as highlighted HAST. While
   * `false` they should render the un-highlighted fallback (plain
   * text) — the published `code` may still contain precomputed HAST
   * left over from SSR, so without this gate non-`init` demos would
   * render highlighted spans on the first paint and defeat the
   * deferred-highlighting trigger.
   *
   * Distinct from `deferHighlight`, which is the narrower
   * "highlight pass is actively in flight" signal consumed by
   * barrier gates (e.g. `useTransformManagement.awaitHighlight`)
   * that must not block when no work is queued.
   */
  highlightReady?: boolean;
  /**
   * Echo of the `highlightAfter` prop on the surrounding
   * `CodeHighlighter` / `CodeHighlighterClient`. Consumers such as
   * `useCode` use this to skip transient highlighting-suppression
   * gates that only matter when highlighting is asynchronous — in
   * `'init'` mode the precomputed HAST already carries the highlight
   * spans, so those gates would just cause a visible flash of
   * unhighlighted content during variant swaps.
   */
  highlightAfter?: 'init' | 'hydration' | 'idle';
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
