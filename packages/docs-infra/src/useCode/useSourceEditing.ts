import * as React from 'react';
import type { Root as HastRoot } from 'hast';
// `stringOrHastToString` is already part of the always-loaded `useCode` shell
// (via `useCopyFunctionality`/`Pre`). Passing it into the lazy source-state module
// keeps that chunk from statically pulling it (and `hastDecompress`).
import { stringOrHastToString } from '../pipeline/hastUtils';
import type { Position } from './SourceEditingEngine';
import type {
  Code,
  ControlledCode,
  ControlledVariantCode,
  EditableSourceProjection,
  VariantCode,
} from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { preParsedCacheKey } from '../CodeHighlighter/parseControlledCode';
import {
  peekSourceEditingEngine,
  loadSourceEditingEngine,
  preloadSourceEditingEngine as preloadSourceEditingEngineCached,
  resetSourceEditingEngineCache as resetSourceEditingEngineCacheCached,
} from './sourceEditingEngineCache';
import type { SourceEditingEngineModule } from './sourceEditingEngineCache';

export type { Position };

/** Warms source-state normalization so the next edit applies synchronously. */
export const preloadSourceEditingEngine = preloadSourceEditingEngineCached;

/** Clears the source-state helper cache. Intended for cold-path tests. */
export const resetSourceEditingEngineCache = resetSourceEditingEngineCacheCached;

/**
 * Internal `setSource` shape used by the editing pipeline. Arguments after the
 * filename carry selection, parsed HAST, and projection state between the editor,
 * `Pre`, and `useSourceEditing`; they are NOT part of
 * the public `useCode` contract — host code should treat `setSource` as
 * `(source, fileName?) => void`.
 */
export type SetSource = (
  source: string,
  fileName?: string,
  position?: Position,
  preParsed?: HastRoot,
  sourceProjection?: EditableSourceProjection,
) => void;

interface UseSourceEditingProps {
  context?: CodeHighlighterContextType;
  selectedVariantKey: string;
  effectiveCode: Code;
  selectedVariant: VariantCode | null;
  disabled?: boolean;
}

export interface UseSourceEditingResult {
  /** Seeds the controller with complete repository source before the first edit. */
  activate?: () => void;
  setSource?: SetSource;
  /**
   * Clears the entire controlled code state back to `undefined`, discarding
   * user edits across **all variants and files** owned by the surrounding
   * `CodeControllerContext` (not just the currently selected file or
   * variant). Once activated, it reseeds the original complete source so the
   * live runtime remains active. Only available when a `CodeControllerContext`
   * with `setCode` is in scope and editing is not disabled.
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
  // Monotonic token bumped by every `setSource`/`reset`. A cold first edit defers
  // its commit until the engine chunk resolves; if a later edit or a `reset`
  // happens before then, the stale deferred commit must NOT run (it would re-apply
  // a superseded edit and, after a reset, reverse it). The deferred callback
  // captures the token at schedule time and bails if it changed.
  const editTokenRef = React.useRef(0);
  const resetTokenRef = React.useRef(0);
  const hasEditedRef = React.useRef(false);
  const activatedRef = React.useRef(false);
  const initialCodeRef = React.useRef<ControlledCode | null>(null);

  const activate = React.useCallback(() => {
    if (!contextSetCode) {
      return;
    }
    activatedRef.current = true;
    const resetToken = resetTokenRef.current;
    const applySeed = (engine: SourceEditingEngineModule) => {
      if (resetTokenRef.current !== resetToken) {
        return;
      }
      initialCodeRef.current ??= engine.toControlledCode(
        effectiveCode,
        selectedVariantKey,
        context?.fallbacks,
        stringOrHastToString,
      );
      contextSetCode((currentCode) => currentCode ?? initialCodeRef.current);
    };
    const warmEngine = peekSourceEditingEngine();
    if (warmEngine) {
      applySeed(warmEngine);
    } else {
      Promise.resolve(loadSourceEditingEngine())
        .then(applySeed)
        .catch(() => {});
    }
  }, [contextSetCode, effectiveCode, selectedVariantKey, context?.fallbacks]);
  const activateRef = React.useRef(activate);
  React.useLayoutEffect(() => {
    activateRef.current = activate;
  }, [activate]);

  const setSource = React.useCallback<SetSource>(
    (source, fileName, position, preParsed, sourceProjection) => {
      if (!contextSetCode) {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
        return;
      }

      // Mark this edit as the latest; a deferred (cold) commit checks this.
      editTokenRef.current += 1;
      const editToken = editTokenRef.current;
      const resetToken = resetTokenRef.current;
      const isFirstEdit = !hasEditedRef.current;

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
        preParsedCache.set(preParsedCacheKey(selectedVariantKey, resolvedFileName), {
          source,
          hast: preParsed,
        });
      }

      const applyUpdate = (engine: SourceEditingEngineModule) => {
        hasEditedRef.current = true;
        const applyEdit = (currentCode: ControlledCode | null | undefined): ControlledCode => {
          const newCode: ControlledCode = currentCode
            ? { ...currentCode }
            : engine.toControlledCode(
                effectiveCode,
                selectedVariantKey,
                context?.fallbacks,
                stringOrHastToString,
              );

          const variant = newCode[selectedVariantKey];
          if (!variant) {
            return newCode;
          }

          const effectiveFileName = fileName ?? selectedVariant?.fileName;
          const isMainFile = effectiveFileName === selectedVariant?.fileName;

          // Recompute the edited file's comment/window state for `source`.
          // `shiftComments` shifts the comment map by the line delta relative to
          // the edit position; on undo/redo the `position.history` flag tells it
          // to reverse the edit (re-inserting deleted lines after the pre-edit
          // caret), and its `collapseMap` restores comments that a deletion
          // collapsed — so undo/redo is reversed from existing state, with no
          // per-edit snapshots kept. `entry` is the file being edited (main
          // variant or an extra file); both expose the same
          // source/comments/collapseMap/totalLines/emptyLines shape.
          const deriveFileState = (
            entry:
              | Pick<
                  ControlledVariantCode,
                  | 'source'
                  | 'comments'
                  | 'collapseMap'
                  | 'totalLines'
                  | 'emptyLines'
                  | 'focusedLines'
                  | 'collapsible'
                  | 'sourceProjection'
                >
              | undefined,
            nextSource: string,
          ) => {
            // `analyzeSource` treats a final newline as a line terminator, so it
            // does not introduce a false line delta.
            const { totalLines, emptyLines } = engine.analyzeSource(nextSource);
            if (!position) {
              return { comments: undefined, collapseMap: undefined, totalLines, emptyLines };
            }
            const oldLineCount =
              entry?.totalLines ??
              (entry?.source != null ? engine.analyzeSource(entry.source).totalLines : 0);
            const { comments, collapseMap } = engine.shiftComments(
              entry?.comments,
              totalLines - oldLineCount,
              position,
              entry?.collapseMap,
              entry?.emptyLines,
            );
            return { comments, collapseMap, totalLines, emptyLines };
          };

          const deriveProjectionState = (
            entry:
              | Pick<ControlledVariantCode, 'focusedLines' | 'collapsible' | 'sourceProjection'>
              | undefined,
            totalLines: number,
          ) => {
            if (sourceProjection) {
              return {
                focusedLines: engine.analyzeSource(sourceProjection.source).totalLines,
                collapsible: sourceProjection.start > 0 || sourceProjection.end < source.length,
              };
            }
            return entry?.sourceProjection ||
              entry?.focusedLines !== undefined ||
              entry?.collapsible
              ? { focusedLines: totalLines, collapsible: false }
              : {};
          };

          if (isMainFile) {
            if (source === variant.source) {
              return currentCode ?? newCode;
            }
            const { totalLines, emptyLines, comments, collapseMap } = deriveFileState(
              variant,
              source,
            );
            newCode[selectedVariantKey] = {
              ...variant,
              source,
              totalLines,
              ...deriveProjectionState(variant, totalLines),
              emptyLines,
              comments,
              collapseMap,
              sourceProjection,
            };
          } else if (effectiveFileName) {
            const extraEntry = variant.extraFiles?.[effectiveFileName];
            if (source === extraEntry?.source) {
              return currentCode ?? newCode;
            }
            const { totalLines, emptyLines, comments, collapseMap } = deriveFileState(
              extraEntry,
              source,
            );
            newCode[selectedVariantKey] = {
              ...variant,
              extraFiles: {
                ...variant.extraFiles,
                [effectiveFileName]: {
                  ...extraEntry,
                  source,
                  totalLines,
                  ...deriveProjectionState(extraEntry, totalLines),
                  emptyLines,
                  comments,
                  collapseMap,
                  sourceProjection,
                },
              },
            };
          }

          const editedVariant = newCode[selectedVariantKey];
          if (editedVariant) {
            if (isFirstEdit) {
              // FIRST edit (precomputed → controlled): carry the pre-edit build
              // inputs so the runner renders the ORIGINAL as a baseline before this
              // (possibly broken) edit, then swaps to it (see `useVariantBuilds`).
              newCode[selectedVariantKey] = {
                ...editedVariant,
                original: { source: variant.source, extraFiles: variant.extraFiles },
              };
            } else if (editedVariant.original) {
              // Subsequent edit: the baseline already rendered — drop `original` so
              // it doesn't linger in (and bloat) the controlled state.
              const stripped = { ...editedVariant };
              delete stripped.original;
              newCode[selectedVariantKey] = stripped;
            }
          }

          return newCode;
        };

        // A SINGLE update carries the edited code to the controller — which the
        // editor reflects immediately (no seed/handoff dance). On the FIRST edit
        // `applyEdit` tags it with `.original`, so the runner renders the original
        // as a baseline before swapping to this edit (see `useVariantBuilds`).
        contextSetCode(applyEdit);
      };

      // Apply synchronously from the warm cache (the common case — the warm
      // effect below loads the engine as soon as the block is editable). On a
      // cold first edit, defer this one update until the chunk resolves; later
      // edits are synchronous.
      const warmEngine = peekSourceEditingEngine();
      if (warmEngine) {
        applyUpdate(warmEngine);
      } else {
        Promise.resolve(loadSourceEditingEngine())
          .then((loaded) => {
            // Bail if a later edit or a reset superseded this one while loading.
            if (editTokenRef.current === editToken && resetTokenRef.current === resetToken) {
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
    ],
  );

  // Warm the edit-time runtime as soon as the block is editable, so the first
  // edit applies synchronously (no flash). Read-only blocks never load it.
  React.useEffect(() => {
    if (peekSourceEditingEngine() || !contextSetCode || disabled) {
      return;
    }
    preloadSourceEditingEngineCached().catch(() => {});
  }, [contextSetCode, disabled]);

  const reset = React.useCallback(() => {
    if (!contextSetCode) {
      console.warn(
        'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
      );
      return;
    }
    // Supersede any pending cold edit so it can't re-apply after this reset.
    editTokenRef.current += 1;
    resetTokenRef.current += 1;
    hasEditedRef.current = false;
    // Evict any pre-parsed HAST so the original re-parses fresh on the next render
    // (matches `refresh()`); a stale entry keyed by (variant, fileName) would otherwise
    // survive the reset and the source viewer could reuse it for the rebuilt original.
    context?.preParsedCache?.clear();
    // Back to an empty controlled state, so the next edit re-tags `.original`.
    contextSetCode(null);
    if (activatedRef.current) {
      activateRef.current();
    }
  }, [contextSetCode, context?.preParsedCache]);

  const isEditable = !disabled && Boolean(contextSetCode) && Boolean(selectedVariant);
  const canReset = !disabled && Boolean(contextSetCode);

  return {
    activate: isEditable ? activate : undefined,
    setSource: isEditable ? setSource : undefined,
    reset: canReset ? reset : undefined,
  };
}
