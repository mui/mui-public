import * as React from 'react';
import type { Position } from 'use-editable';
import type {
  Code,
  CollapseMap,
  ControlledCode,
  ControlledVariantExtraFiles,
  SourceComments,
  VariantCode,
} from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { stringOrHastToString } from '../pipeline/hastUtils';

export type { Position };

interface UseSourceEditingProps {
  context?: CodeHighlighterContextType;
  selectedVariantKey: string;
  effectiveCode: Code;
  selectedVariant: VariantCode | null;
  disabled?: boolean;
}

export interface UseSourceEditingResult {
  setSource?: (source: string, fileName?: string, position?: Position) => void;
}

interface ShiftResult {
  comments: SourceComments | undefined;
  collapseMap: CollapseMap | undefined;
}

/**
 * Shifts 1-indexed comment line numbers after a source edit.
 * Uses the cursor position (0-indexed in new text) and line count delta
 * to determine which comments move and by how much.
 *
 * When lines are deleted, comments from the deleted range are collapsed
 * onto the edit line and recorded in a collapseMap so they can be restored
 * if the deletion is undone (lines re-added at the same position).
 */
function shiftComments(
  comments: SourceComments | undefined,
  oldSource: string | null | undefined,
  newSource: string,
  position: Position,
  existingCollapseMap: CollapseMap | undefined,
): ShiftResult {
  if (!comments || Object.keys(comments).length === 0) {
    return { comments, collapseMap: existingCollapseMap };
  }

  const oldLineCount = oldSource != null ? oldSource.split('\n').length : 0;
  const newLineCount = newSource.split('\n').length;
  const lineDelta = newLineCount - oldLineCount;

  if (lineDelta === 0) {
    return { comments, collapseMap: existingCollapseMap };
  }

  // position.line is 0-indexed in the new text.
  // Convert to the 1-indexed line in old text that the cursor was on:
  // For additions (lineDelta > 0): cursor moved down, old line = position.line - lineDelta
  // For deletions (lineDelta < 0): cursor stayed, old line = position.line
  const editLine = position.line - Math.max(0, lineDelta) + 1; // 1-indexed

  const shifted: SourceComments = {};
  let collapseMap: CollapseMap = existingCollapseMap ? { ...existingCollapseMap } : {};
  const newCollapsed: Array<{ offset: number; comments: string[] }> = [];

  // Build a list of comment strings to exclude from the edit line after restore.
  // Uses an array (not Set) to correctly handle duplicate comment strings
  // across separate collapsed entries.
  let restoredComments: string[] | undefined;

  // On expansion, check if we can restore previously collapsed comments
  if (lineDelta > 0 && collapseMap[editLine]) {
    const entries = collapseMap[editLine];
    const restored: Array<{ offset: number; comments: string[] }> = [];
    const remaining: Array<{ offset: number; comments: string[] }> = [];

    for (const entry of entries) {
      if (entry.offset <= lineDelta) {
        restored.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    // Place restored comments at their original offsets from the edit line
    restoredComments = [];
    for (const entry of restored) {
      const restoredLine = editLine + entry.offset;
      shifted[restoredLine] = [...(shifted[restoredLine] ?? []), ...entry.comments];
      restoredComments.push(...entry.comments);
    }

    if (remaining.length > 0) {
      collapseMap[editLine] = remaining;
    } else {
      delete collapseMap[editLine];
    }
  }

  for (const [lineStr, commentArr] of Object.entries(comments)) {
    const line = Number(lineStr);
    if (line <= editLine) {
      // Before or at the edit line — unchanged.
      // If this is the edit line and we restored comments from it, filter them out.
      let arr = commentArr;
      if (line === editLine && restoredComments) {
        const remaining = [...commentArr];
        for (const c of restoredComments) {
          const idx = remaining.indexOf(c);
          if (idx !== -1) {
            remaining.splice(idx, 1);
          }
        }
        arr = remaining;
      }
      if (arr.length > 0) {
        shifted[line] = [...(shifted[line] ?? []), ...arr];
      }
    } else if (lineDelta < 0 && line <= editLine - lineDelta) {
      // Within the deleted range — collapse comments onto the edit line.
      // Boundary comments (ending with '-end') go to editLine + 1 instead,
      // so range-end markers stay at the first line after the highlighted range.
      // Boundary comments are NOT tracked in collapseMap — they shift normally
      // on subsequent edits so the range naturally expands/contracts.
      const regular = commentArr.filter((c) => !c.endsWith('-end'));
      const boundary = commentArr.filter((c) => c.endsWith('-end'));

      if (regular.length > 0) {
        shifted[editLine] = [...(shifted[editLine] ?? []), ...regular];
        newCollapsed.push({ offset: line - editLine, comments: regular });
      }
      if (boundary.length > 0) {
        const boundaryTarget = editLine + 1;
        shifted[boundaryTarget] = [...(shifted[boundaryTarget] ?? []), ...boundary];
      }
    } else {
      // After the edit — shift
      const newLine = line + lineDelta;
      shifted[newLine] = [...(shifted[newLine] ?? []), ...commentArr];
    }
  }

  // Also shift existing collapse map entries that are after the edit line
  const shiftedCollapseMap: CollapseMap = {};
  for (const [lineStr, entries] of Object.entries(collapseMap)) {
    const line = Number(lineStr);
    if (line <= editLine) {
      shiftedCollapseMap[line] = entries;
    } else {
      shiftedCollapseMap[line + lineDelta] = entries;
    }
  }
  collapseMap = shiftedCollapseMap;

  if (newCollapsed.length > 0) {
    collapseMap[editLine] = [...(collapseMap[editLine] ?? []), ...newCollapsed];
  }

  const finalCollapseMap = Object.keys(collapseMap).length > 0 ? collapseMap : undefined;

  return { comments: shifted, collapseMap: finalCollapseMap };
}

/**
 * Converts Code to ControlledCode, normalizing sources and extraFiles entries.
 * VariantSource can be HAST nodes; ControlledCode requires plain strings.
 * VariantExtraFiles allows plain string entries; ControlledVariantExtraFiles
 * requires `{ source }` objects. Without this normalization, parseControlledCode
 * reads `.source` on a string and gets `undefined`, dropping file content.
 */
function toControlledCode(code: Code): ControlledCode {
  const result: ControlledCode = {};
  for (const [key, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string') {
      continue;
    }
    const source = variant.source != null ? stringOrHastToString(variant.source) : variant.source;

    let extraFiles: ControlledVariantExtraFiles | undefined;
    if (variant.extraFiles) {
      extraFiles = {};
      for (const [fileName, entry] of Object.entries(variant.extraFiles)) {
        if (typeof entry === 'string') {
          extraFiles[fileName] = { source: entry };
        } else {
          extraFiles[fileName] = {
            source: entry.source != null ? stringOrHastToString(entry.source) : null,
            ...(entry.comments ? { comments: entry.comments } : {}),
          };
        }
      }
    }

    result[key] = {
      ...variant,
      source,
      ...(extraFiles ? { extraFiles } : {}),
    } as ControlledCode[string];
  }
  return result;
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

  const setSource = React.useCallback(
    (source: string, fileName?: string, position?: Position) => {
      if (!contextSetCode) {
        console.warn(
          'setCode is not available in the current context. Ensure you are using CodeControllerContext.',
        );
        return;
      }

      contextSetCode((currentCode: ControlledCode | undefined) => {
        const newCode: ControlledCode = currentCode
          ? { ...currentCode }
          : toControlledCode(effectiveCode);

        const variant = newCode[selectedVariantKey];
        if (!variant) {
          return newCode;
        }

        const effectiveFileName = fileName ?? selectedVariant?.fileName;
        const isMainFile = effectiveFileName === selectedVariant?.fileName;

        if (isMainFile) {
          const { comments: shiftedComments, collapseMap: newCollapseMap } = position
            ? shiftComments(variant.comments, variant.source, source, position, variant.collapseMap)
            : { comments: undefined, collapseMap: undefined };
          newCode[selectedVariantKey] = {
            ...variant,
            source,
            comments: shiftedComments,
            collapseMap: newCollapseMap,
          };
        } else if (effectiveFileName) {
          const extraEntry = variant.extraFiles?.[effectiveFileName];
          const { comments: shiftedComments, collapseMap: newCollapseMap } = position
            ? shiftComments(
                extraEntry?.comments,
                extraEntry?.source,
                source,
                position,
                extraEntry?.collapseMap,
              )
            : { comments: undefined, collapseMap: undefined };
          newCode[selectedVariantKey] = {
            ...variant,
            extraFiles: {
              ...variant.extraFiles,
              [effectiveFileName]: {
                ...extraEntry,
                source,
                comments: shiftedComments,
                collapseMap: newCollapseMap,
              },
            },
          };
        }

        return newCode;
      });
    },
    [contextSetCode, selectedVariantKey, effectiveCode, selectedVariant],
  );

  const isEditable = !disabled && Boolean(contextSetCode) && Boolean(selectedVariant);

  return {
    setSource: isEditable ? setSource : undefined,
  };
}
