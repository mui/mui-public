// The edit-time source-manipulation runtime, split out of `useSourceEditing` so
// its pure-but-not-tiny logic (line analysis, comment/collapse shifting,
// controlled-code normalization) loads only when a block is actually edited.
// `useSourceEditing` is a thin shell that warms this chunk as soon as a block
// becomes editable and applies it synchronously thereafter (live editing never
// waits). A read-only block never pulls this chunk.

import type { Position } from './useEditable';
import type {
  Code,
  CollapseMap,
  ControlledCode,
  ControlledVariantExtraFiles,
  Fallbacks,
  SourceComments,
  VariantSource,
} from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';

/**
 * Converts a `VariantSource` (string or HAST) to a plain string. Injected into
 * {@link toControlledCode} so this engine chunk never statically imports
 * `stringOrHastToString` (and its `hastDecompress` dependency): the always-loaded
 * `useCode` shell already has it (via `useCopyFunctionality`/`Pre`) and passes it
 * in, keeping it counted in the shell instead of hoisted into its own chunk.
 */
export type StringOrHastToString = (source: VariantSource, fallback?: FallbackNode[]) => string;

interface ShiftResult {
  comments: SourceComments | undefined;
  collapseMap: CollapseMap | undefined;
}

/**
 * Counts the number of lines in a string and records which 1-indexed lines are
 * empty/whitespace-only, in a single pass, without allocating a line array.
 * `emptyLines` is omitted when no blank lines were found to keep the common
 * case allocation-free.
 */
export function analyzeSource(source: string): { totalLines: number; emptyLines?: number[] } {
  let totalLines = 1;
  let emptyLines: number[] | undefined;
  let lineStart = 0;
  // Ignore a single trailing newline. The live contentEditable always
  // terminates its serialized text with one (`toString`), and the gutter
  // (`starryNightGutter`) plus the caret helpers (`getLineInfo`/`getPosition`)
  // all treat that final newline as a line *terminator*, not as an extra empty
  // line. Counting it here would over-report `totalLines` versus the rendered
  // line elements and inflate the line delta of the first edit by one (which
  // shifts every emphasis comment down a line). A source with no trailing
  // newline and the same source with one therefore report the same line count.
  let len = source.length;
  if (len > 0 && source.charCodeAt(len - 1) === 0x0a /* \n */) {
    len -= 1;
  }
  for (let i = 0; i <= len; i += 1) {
    if (i === len || source.charCodeAt(i) === 0x0a /* \n */) {
      let isEmpty = true;
      for (let j = lineStart; j < i; j += 1) {
        const ch = source.charCodeAt(j);
        // 0x20=space, 0x09=tab, 0x0D=CR, 0x0B=VT, 0x0C=FF
        if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0d && ch !== 0x0b && ch !== 0x0c) {
          isEmpty = false;
          break;
        }
      }
      if (isEmpty) {
        if (!emptyLines) {
          emptyLines = [];
        }
        emptyLines.push(totalLines);
      }
      if (i < len) {
        totalLines += 1;
        lineStart = i + 1;
      }
    }
  }
  return emptyLines ? { totalLines, emptyLines } : { totalLines };
}

/**
 * Shifts 1-indexed comment line numbers after a source edit.
 * Accepts a precomputed `lineDelta` (positive = lines added, negative = lines deleted)
 * and the cursor `position` (0-indexed in the new text) to determine which
 * comments move and by how much.
 *
 * When lines are deleted, comments from the deleted range are collapsed
 * onto the edit line and recorded in a collapseMap so they can be restored
 * if the deletion is undone (lines re-added at the same position).
 *
 * Empty/whitespace-only deleted lines are special: since they had no real
 * content that "shifted upward" into editLine, their comments are pushed
 * to editLine + 1 (like `-end` boundary markers) so the highlighted region
 * shrinks instead of shifting onto the previous line.
 */
export function shiftComments(
  comments: SourceComments | undefined,
  lineDelta: number,
  position: Position,
  existingCollapseMap: CollapseMap | undefined,
  oldEmptyLines?: number[],
): ShiftResult {
  const hasComments = comments != null && Object.keys(comments).length > 0;
  const hasCollapsed = existingCollapseMap != null && Object.keys(existingCollapseMap).length > 0;

  // Nothing to shift and nothing stashed to restore. (When the comment map is
  // empty but the collapseMap holds a fully-deleted frame, we must still run so
  // an undo/expansion can reopen it.)
  if (!hasComments && !hasCollapsed) {
    return { comments, collapseMap: existingCollapseMap };
  }

  if (lineDelta === 0) {
    return { comments, collapseMap: existingCollapseMap };
  }

  // position.line is 0-indexed in the new text.
  // lineDelta is positive for insertions and negative for deletions.
  // Convert to the 1-indexed line in old text that the cursor was on:
  // For additions (lineDelta > 0), the re-inserted lines belong AFTER the caret
  // (`position.line + 1`) when the caret is the *pre-deletion* position rather
  // than a forward-typing cursor that moved down with the insert:
  //   - Undo of a deletion (`position.history === 'undo'`): the saved caret is
  //     where the delete happened and never moved, so the lines reappear after
  //     it. This covers a single-line merge (extent 0) — which the forward
  //     formula would misplace by one line — as well as multi-line deletes.
  //   - Re-inserting a multi-line selection (extent > 0): the saved position
  //     points to the selection-start where the lines begin.
  // Otherwise (forward typing, or redo of an insert) the cursor is the POST-edit
  // position and moved down by lineDelta, so old line = position.line - lineDelta.
  // For deletions (lineDelta < 0): cursor stayed where it was, old line = position.line.
  // On an undo, reverse the edit at the line the FORWARD edit pivoted on (its
  // post-edit caret, supplied as `historyPivotLine`) rather than this
  // destination caret — they diverge after a selection edit (e.g. Select All
  // deletes from a selection that didn't start at the caret), and the
  // collapseMap that holds the deleted frame is keyed by that forward pivot.
  const pivotLine =
    position.history === 'undo' && position.historyPivotLine !== undefined
      ? position.historyPivotLine
      : position.line;
  const reinsertsAfterCaret = lineDelta > 0 && (position.history === 'undo' || position.extent > 0);
  const editLine = reinsertsAfterCaret ? pivotLine + 1 : pivotLine - Math.max(0, lineDelta) + 1; // 1-indexed

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

  // O(1) lookup against the precomputed empty-line set from the old source.
  const oldEmptyLineSet =
    oldEmptyLines && oldEmptyLines.length > 0 ? new Set(oldEmptyLines) : undefined;

  // For a deletion, find range bases whose BOTH `-start` and `-end` markers fall
  // inside the deleted block. Such a range is removed entirely — there is nowhere
  // to shift its markers to — so we stash BOTH ends in the collapseMap and leave
  // neither visible: the frame disappears now and an undo rebuilds it intact at
  // its original offsets. (A range whose start survives OUTSIDE the block only
  // shrinks, so its `-end` keeps the editLine+1 placement below and stays
  // untracked, matching the expand/contract behavior.)
  let fullyDeletedRanges: Set<string> | undefined;
  if (lineDelta < 0) {
    const startBases = new Set<string>();
    const endBases = new Set<string>();
    for (const [lineStr, commentArr] of Object.entries(comments ?? {})) {
      const line = Number(lineStr);
      if (line > editLine && line <= editLine - lineDelta) {
        for (const comment of commentArr) {
          if (comment.endsWith('-end')) {
            endBases.add(comment.slice(0, -'-end'.length));
          } else if (comment.endsWith('-start')) {
            startBases.add(comment.slice(0, -'-start'.length));
          }
        }
      }
    }
    for (const base of startBases) {
      if (endBases.has(base)) {
        (fullyDeletedRanges ??= new Set()).add(base);
      }
    }
  }

  for (const [lineStr, commentArr] of Object.entries(comments ?? {})) {
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
      // Three destinations:
      //  - Markers of a FULLY deleted range (both ends in the block): stash in
      //    the collapseMap ONLY, so the frame vanishes now and an undo restores
      //    both ends at their original offsets.
      //  - Surviving range-end ('-end') markers, and regular comments off an
      //    empty/whitespace-only deleted line: go to editLine + 1, so the range
      //    shrinks rather than expanding onto the line above. Left untracked so
      //    they shift normally as the range contracts/expands.
      //  - Other regular comments: collapse onto editLine AND track in the
      //    collapseMap so a later expansion can restore them at their offset.
      const wasEmptyLine = oldEmptyLineSet?.has(line) ?? false;
      const reopenable: string[] = [];
      const collapseHere: string[] = [];
      const toBoundary: string[] = [];
      for (const comment of commentArr) {
        const isEnd = comment.endsWith('-end');
        let base: string | undefined;
        if (isEnd) {
          base = comment.slice(0, -'-end'.length);
        } else if (comment.endsWith('-start')) {
          base = comment.slice(0, -'-start'.length);
        }
        if (base !== undefined && fullyDeletedRanges?.has(base)) {
          reopenable.push(comment);
        } else if (isEnd || wasEmptyLine) {
          toBoundary.push(comment);
        } else {
          collapseHere.push(comment);
        }
      }
      if (reopenable.length > 0) {
        newCollapsed.push({ offset: line - editLine, comments: reopenable });
      }
      if (collapseHere.length > 0) {
        shifted[editLine] = [...(shifted[editLine] ?? []), ...collapseHere];
        newCollapsed.push({ offset: line - editLine, comments: collapseHere });
      }
      if (toBoundary.length > 0) {
        const boundaryTarget = editLine + 1;
        shifted[boundaryTarget] = [...(shifted[boundaryTarget] ?? []), ...toBoundary];
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
export function toControlledCode(
  code: Code,
  activeVariantKey: string | undefined,
  activeFallbacks: Fallbacks | undefined,
  toString: StringOrHastToString,
): ControlledCode {
  const result: ControlledCode = {};
  for (const [key, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string') {
      continue;
    }
    // The per-file `fallback` is the DEFLATE dictionary for a `hastCompressed`
    // source. It rides on the `VariantCode` in the no-`ContentLoading` path; on
    // the `ContentLoading` path the active variant's fallback is stripped off
    // `Code` and lives in `context.fallbacks` (`activeFallbacks`) instead — so
    // prefer that for the active variant, falling back to the variant's field.
    const variantFallbacks = key === activeVariantKey ? activeFallbacks : undefined;
    const mainFallback =
      (variant.fileName ? variantFallbacks?.[variant.fileName] : undefined) ?? variant.fallback;
    const source = variant.source != null ? toString(variant.source, mainFallback) : variant.source;

    let extraFiles: ControlledVariantExtraFiles | undefined;
    if (variant.extraFiles) {
      extraFiles = {};
      for (const [fileName, entry] of Object.entries(variant.extraFiles)) {
        if (typeof entry === 'string') {
          extraFiles[fileName] = { source: entry, ...analyzeSource(entry) };
        } else {
          const entryFallback = variantFallbacks?.[fileName] ?? entry.fallback;
          const extraSource = entry.source != null ? toString(entry.source, entryFallback) : null;
          extraFiles[fileName] = {
            source: extraSource,
            ...(entry.comments ? { comments: entry.comments } : {}),
            ...(extraSource != null ? analyzeSource(extraSource) : {}),
          };
        }
      }
    }

    result[key] = {
      ...variant,
      source,
      ...(source != null ? analyzeSource(source) : {}),
      ...(extraFiles ? { extraFiles } : {}),
    } as ControlledCode[string];
  }
  return result;
}
