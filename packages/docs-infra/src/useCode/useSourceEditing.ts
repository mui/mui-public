import * as React from 'react';
import type { Root as HastRoot } from 'hast';
import type { Position } from './useEditable';
import type { Code, ControlledCode, VariantCode } from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { useCodeContext } from '../CodeProvider/CodeContext';
import {
  peekEditingEngine,
  loadEditingEngine,
  preloadEditingEngine,
  resetEditingEngineCache,
  type EditingEngineModule,
} from './editingEngineCache';

export type { Position };

// The edit-time runtime (`analyzeSource`/`shiftComments`/`toControlledCode`) lives
// in the shared `./EditingEngine` chunk — the SAME chunk `useEditable` loads, so
// they download together. The shell warms it as soon as a block is editable (the
// effect below); by the time the user can type — which itself waits on the
// editable engine — the engine is ready and `setSource` runs synchronously. A
// read-only block never loads it.

/**
 * Warms the editing engine so the next edit applies synchronously. Back-compat
 * alias for {@link preloadEditingEngine}; the cache is shared with `useEditable`.
 */
export const preloadSourceEditingEngine = preloadEditingEngine;

/** Clears the shared editing-engine cache. Back-compat alias; for tests. */
export const resetSourceEditingEngineCache = resetEditingEngineCache;

/**
 * Internal `setSource` shape used by the editing pipeline. The 3rd and 4th
 * arguments (caret position, pre-parsed HAST) are wired between sibling
 * hooks (`useEditable` → `Pre` → `useSourceEditing`) and are NOT part of
 * the public `useCode` contract — host code should treat `setSource` as
 * `(source, fileName?) => void`.
 */
export type SetSource = (
  source: string,
  fileName?: string,
  position?: Position,
  preParsed?: HastRoot,
) => void;

interface UseSourceEditingProps {
  context?: CodeHighlighterContextType;
  selectedVariantKey: string;
  effectiveCode: Code;
  selectedVariant: VariantCode | null;
  disabled?: boolean;
}

export interface UseSourceEditingResult {
  setSource?: SetSource;
  /**
   * Clears the entire controlled code state back to `undefined`, discarding
   * user edits across **all variants and files** owned by the surrounding
   * `CodeControllerContext` (not just the currently selected file or
   * variant), and falling back to the original code provided to the
   * `CodeHighlighter`. Only available when a `CodeControllerContext` with
   * `setCode` is in scope and editing is not disabled.
   */
  reset?: () => void;
}

/**
 * Hook for managing source code editing functionality.
 *
 * Returns a `setSource(source, fileName?)` callback that updates the correct file
 * (main or extra) within the controlled code for the current variant.
 * If `fileName` is omitted, the currently selected file is assumed.
 */
export function useSourceEditing({
  context,
  selectedVariantKey,
  effectiveCode,
  selectedVariant,
  disabled,
}: UseSourceEditingProps): UseSourceEditingResult {
  const contextSetCode = context?.setCode;
  // The provider's editing-engine loader (shared with `useEditable`); dedupes the
  // chunk fetch page-wide. Undefined without a provider → the built-in default.
  const { editingEngineLoader } = useCodeContext();

  // Monotonic token bumped by every `setSource`/`reset`. A cold first edit
  // defers its commit into a microtask; if a later edit or a `reset` happens
  // before the engine resolves, the stale deferred commit must NOT run (it would
  // re-apply a superseded edit and, after a reset, reverse it). The deferred
  // callback captures the token at schedule time and bails if it changed.
  const editTokenRef = React.useRef(0);

  const setSource = React.useCallback<SetSource>(
    (source, fileName, position, preParsed) => {
      if (!contextSetCode) {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
        return;
      }

      // Mark this edit as the latest; a deferred (cold) commit checks this.
      editTokenRef.current += 1;
      const editToken = editTokenRef.current;

      // Stash any pre-computed parse result against the resolved file name
      // BEFORE the controlled-code update commits, so that the synchronous
      // `parseControlledCode` pass triggered by the resulting React render
      // can reuse the cached HAST instead of re-parsing the new source.
      // The cache is owned by `CodeHighlighterClient` (per-highlighter
      // state) and exposed on the context for both the writer (here) and
      // reader (`parseControlledCode`).
      const resolvedFileName = fileName ?? selectedVariant?.fileName;
      const preParsedCache = context?.preParsedCache;
      if (preParsed !== undefined && preParsedCache && resolvedFileName) {
        preParsedCache.set(resolvedFileName, {
          source,
          hast: preParsed,
        });
      }

      const applyUpdate = (engine: EditingEngineModule) => {
        contextSetCode((currentCode: ControlledCode | undefined) => {
          const newCode: ControlledCode = currentCode
            ? { ...currentCode }
            : engine.toControlledCode(effectiveCode, selectedVariantKey, context?.fallbacks);

          const variant = newCode[selectedVariantKey];
          if (!variant) {
            return newCode;
          }

          const effectiveFileName = fileName ?? selectedVariant?.fileName;
          const isMainFile = effectiveFileName === selectedVariant?.fileName;

          if (isMainFile) {
            if (source === variant.source) {
              return currentCode ?? newCode;
            }
            const { totalLines: newLineCount, emptyLines: newEmptyLines } =
              engine.analyzeSource(source);
            const oldLineCount =
              variant.totalLines ??
              (variant.source != null ? engine.analyzeSource(variant.source).totalLines : 0);
            const { comments: shiftedComments, collapseMap: newCollapseMap } = position
              ? engine.shiftComments(
                  variant.comments,
                  newLineCount - oldLineCount,
                  position,
                  variant.collapseMap,
                  variant.emptyLines,
                )
              : { comments: undefined, collapseMap: undefined };
            newCode[selectedVariantKey] = {
              ...variant,
              source,
              totalLines: newLineCount,
              emptyLines: newEmptyLines,
              comments: shiftedComments,
              collapseMap: newCollapseMap,
            };
          } else if (effectiveFileName) {
            const extraEntry = variant.extraFiles?.[effectiveFileName];
            if (source === extraEntry?.source) {
              return currentCode ?? newCode;
            }
            const { totalLines: newLineCount, emptyLines: newEmptyLines } =
              engine.analyzeSource(source);
            const oldLineCount =
              extraEntry?.totalLines ??
              (extraEntry?.source != null ? engine.analyzeSource(extraEntry.source).totalLines : 0);
            const { comments: shiftedComments, collapseMap: newCollapseMap } = position
              ? engine.shiftComments(
                  extraEntry?.comments,
                  newLineCount - oldLineCount,
                  position,
                  extraEntry?.collapseMap,
                  extraEntry?.emptyLines,
                )
              : { comments: undefined, collapseMap: undefined };
            newCode[selectedVariantKey] = {
              ...variant,
              extraFiles: {
                ...variant.extraFiles,
                [effectiveFileName]: {
                  ...extraEntry,
                  source,
                  totalLines: newLineCount,
                  emptyLines: newEmptyLines,
                  comments: shiftedComments,
                  collapseMap: newCollapseMap,
                },
              },
            };
          }

          return newCode;
        });
      };

      // Apply synchronously from the warm cache (the common case — the warm
      // effect below loads the engine as soon as the block is editable). On a
      // cold first edit, defer this one update until the chunk resolves; later
      // edits are synchronous.
      const warmEngine = peekEditingEngine();
      if (warmEngine) {
        applyUpdate(warmEngine);
      } else {
        Promise.resolve(loadEditingEngine(editingEngineLoader))
          .then((loaded) => {
            // Bail if a later edit or a reset superseded this one while loading.
            if (editTokenRef.current === editToken) {
              applyUpdate(loaded);
            }
          })
          .catch(() => {});
      }
    },
    [
      contextSetCode,
      selectedVariantKey,
      effectiveCode,
      selectedVariant,
      context?.preParsedCache,
      context?.fallbacks,
      editingEngineLoader,
    ],
  );

  // Warm the edit-time runtime as soon as the block is editable, so the first
  // edit applies synchronously (no flash). Read-only blocks never load it.
  React.useEffect(() => {
    if (peekEditingEngine() || !contextSetCode || disabled) {
      return;
    }
    preloadEditingEngine(editingEngineLoader).catch(() => {});
  }, [contextSetCode, disabled, editingEngineLoader]);

  const reset = React.useCallback(() => {
    if (!contextSetCode) {
      console.warn(
        'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
      );
      return;
    }
    // Supersede any pending cold edit so it can't re-apply after this reset.
    editTokenRef.current += 1;
    contextSetCode(undefined);
  }, [contextSetCode]);

  const isEditable = !disabled && Boolean(contextSetCode) && Boolean(selectedVariant);
  const canReset = !disabled && Boolean(contextSetCode);

  return {
    setSource: isEditable ? setSource : undefined,
    reset: canReset ? reset : undefined,
  };
}
