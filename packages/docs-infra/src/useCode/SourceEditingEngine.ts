// The edit-time source-manipulation runtime, split out of `useSourceEditing` so
// its pure-but-not-tiny logic (line analysis, comment/collapse shifting,
// controlled-code normalization) loads only when a block is actually edited.
// `useSourceEditing` is a thin shell that warms this chunk as soon as a block
// becomes editable and applies it synchronously thereafter (live editing never
// waits). A read-only block never pulls this chunk.

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

/** Selection metadata used to keep source emphasis aligned after line edits. */
export interface Position {
  position: number;
  extent: number;
  content: string;
  line: number;
  history?: 'undo' | 'redo';
  historyPivotLine?: number;
  deletedFromLineStart?: boolean;
}

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
  // Treat a final newline as a terminator rather than an additional rendered line.
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
  let editLine = reinsertsAfterCaret ? pivotLine + 1 : pivotLine - Math.max(0, lineDelta) + 1; // 1-indexed
  // A selection delete that started at column 0 removed whole lines from the
  // FIRST line down; the post-edit (or restored) caret lands on the line that
  // shifted up from below, so the true anchor — the last surviving line above
  // the deletion — is one line higher. Without this the deleted first line is
  // treated as surviving, stranding a marker that sits on it (and the undo
  // can't rebuild the frame). Rides through undo via the same flag so the
  // reversal anchors on the same line, keeping the collapseMap keys aligned.
  if (position.deletedFromLineStart) {
    editLine -= 1;
  }

  // When the deletion reaches the very first line, `editLine` underflows to 0:
  // there is no surviving line ABOVE the deletion to anchor onto. The 1-indexed
  // comment map has no line 0, so collapsed comments and their collapseMap keys
  // must instead anchor on the FIRST SURVIVING line — the one that becomes the
  // new line 1. `editLine` itself stays 0 so the deleted-range partition below
  // still treats the old first line as deleted (not surviving); only the WRITE
  // targets (collapse destination, collapseMap key, restore offsets) use this
  // clamped anchor. Off the top-of-file case `collapseLine === editLine`, so the
  // normal middle/bottom paths are byte-for-byte unchanged.
  const collapseLine = editLine < 1 ? 1 : editLine;

  const shifted: SourceComments = {};
  let collapseMap: CollapseMap = existingCollapseMap ? { ...existingCollapseMap } : {};
  const newCollapsed: Array<{ offset: number; comments: string[]; boundary?: true }> = [];

  // Build a list of comment strings to exclude from the edit line after restore.
  // Uses an array (not Set) to correctly handle duplicate comment strings
  // across separate collapsed entries.
  let restoredComments: string[] | undefined;
  // Boundary `-end`/empty-line markers were also left VISIBLE at editLine+1 when
  // the range first shrank. On an undo that restores them at their true offset we
  // must drop that visible boundary copy (else the marker duplicates and the copy
  // shifts a full delta, landing one line past the original). Collected here and
  // filtered off editLine+1 in the main loop below.
  let restoredBoundaryComments: string[] | undefined;
  const isUndo = position.history === 'undo';

  // On expansion, check if we can restore previously collapsed comments
  if (lineDelta > 0 && collapseMap[collapseLine]) {
    const entries = collapseMap[collapseLine];
    const restored: Array<{ offset: number; comments: string[]; boundary?: true }> = [];
    const remaining: Array<{ offset: number; comments: string[]; boundary?: true }> = [];

    for (const entry of entries) {
      // Boundary entries (a shrunk range's `-end`/empty-line `-start`) are
      // undo-only memory: they restore the marker EXACTLY on an undo. On a
      // forward re-insert (or redo) the still-visible boundary copy expands the
      // range as before, so the stash is dropped rather than restored — leaving
      // it would re-restore the marker on a later undo of an unrelated edit.
      if (entry.boundary && !isUndo) {
        continue;
      }
      if (entry.offset <= lineDelta) {
        restored.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    // Place restored comments at their original offsets from the edit line
    restoredComments = [];
    restoredBoundaryComments = [];
    for (const entry of restored) {
      const restoredLine = collapseLine + entry.offset;
      shifted[restoredLine] = [...(shifted[restoredLine] ?? []), ...entry.comments];
      if (entry.boundary) {
        // Filter the visible boundary copy (at editLine+1), not the collapseLine.
        restoredBoundaryComments.push(...entry.comments);
      } else {
        restoredComments.push(...entry.comments);
      }
    }

    if (remaining.length > 0) {
      collapseMap[collapseLine] = remaining;
    } else {
      delete collapseMap[collapseLine];
    }
  }

  // O(1) lookup against the precomputed empty-line set from the old source.
  const oldEmptyLineSet =
    oldEmptyLines && oldEmptyLines.length > 0 ? new Set(oldEmptyLines) : undefined;

  // For a deletion, find range bases that are removed entirely — every line they
  // highlighted is gone — so the frame must disappear (its `-start`, which is in
  // the deleted block, is stashed rather than collapsed onto a surviving line
  // above as a phantom highlight) and an undo can rebuild it.
  //
  // Two shapes qualify. Both require the `-start` to fall inside the deleted block
  // `(editLine, editLine - lineDelta]`:
  //   1. The `-end` is also inside the block (the selection deleted right through
  //      it). Both markers are stashed and an undo restores them at their offsets.
  //   2. The `-end` is on `boundaryLine` — the first SURVIVING line just past the
  //      block. A range's `-end` is EXCLUSIVE, sitting one line below its last
  //      highlighted line, so a selection that removes every highlighted line stops
  //      with the caret on that `-end` line, leaving it intact. The range is still
  //      empty, so it is fully deleted; the surviving `-end` then shifts up as a
  //      lone marker (rendering nothing) and is the undo memory that re-pairs with
  //      the restored `-start`.
  // (A range whose `-start` survives OUTSIDE the block only shrinks, so its `-end`
  // keeps the editLine+1 placement below and stays untracked.)
  let fullyDeletedRanges: Set<string> | undefined;
  if (lineDelta < 0) {
    const startBases = new Set<string>();
    const endBases = new Set<string>();
    const boundaryLine = editLine - lineDelta + 1;
    for (const [lineStr, commentArr] of Object.entries(comments ?? {})) {
      const line = Number(lineStr);
      const inBlock = line > editLine && line <= editLine - lineDelta;
      if (inBlock) {
        for (const comment of commentArr) {
          if (comment.endsWith('-end')) {
            endBases.add(comment.slice(0, -'-end'.length));
          } else if (comment.endsWith('-start')) {
            startBases.add(comment.slice(0, -'-start'.length));
          }
        }
      } else if (line === boundaryLine) {
        // Only an exclusive `-end` on the boundary closes a fully-deleted range; a
        // `-start` here belongs to a surviving line below and must not be paired.
        for (const comment of commentArr) {
          if (comment.endsWith('-end')) {
            endBases.add(comment.slice(0, -'-end'.length));
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
      // Offsets and the regular-collapse destination anchor on `collapseLine`
      // (the first surviving line) so they stay valid at the top of the file,
      // where `editLine` is 0. The boundary target stays `editLine + 1`: in the
      // middle of the file that is the line just BELOW the surviving anchor, and
      // at the top of the file it coincides with `collapseLine` (the new line 1).
      if (reopenable.length > 0) {
        newCollapsed.push({ offset: line - collapseLine, comments: reopenable });
      }
      if (collapseHere.length > 0) {
        shifted[collapseLine] = [...(shifted[collapseLine] ?? []), ...collapseHere];
        newCollapsed.push({ offset: line - collapseLine, comments: collapseHere });
      }
      if (toBoundary.length > 0) {
        const boundaryTarget = editLine + 1;
        shifted[boundaryTarget] = [...(shifted[boundaryTarget] ?? []), ...toBoundary];
        // Keep the marker VISIBLE at editLine+1 (the live contracted view) AND
        // stash its TRUE offset, flagged `boundary`, so an undo can restore it
        // exactly. A forward re-insert ignores this stash and lets the visible
        // copy expand the range instead (see the restore loop above).
        newCollapsed.push({ offset: line - collapseLine, comments: toBoundary, boundary: true });
      }
    } else {
      // After the edit — shift.
      let arr = commentArr;
      // At the top of the file the collapse anchor (`collapseLine`) is the new
      // line 1, which sits AFTER the conceptual edit point (`editLine` is 0), so
      // its entry lands in this shifting branch rather than the unchanged one. On
      // an undo we restored its collapsed comments to their true lines already,
      // so drop those copies here before the leftover (a survivor that shifted up
      // during the delete) shifts back down. In the middle of the file
      // `collapseLine === editLine`, which never reaches this branch, so this is
      // inert there.
      if (line === collapseLine && restoredComments) {
        const remaining = [...arr];
        for (const c of restoredComments) {
          const idx = remaining.indexOf(c);
          if (idx !== -1) {
            remaining.splice(idx, 1);
          }
        }
        arr = remaining;
      }
      // On an undo that restored a shrunk range's boundary marker at its true
      // offset, drop the still-visible boundary copy (at editLine+1) so it
      // doesn't duplicate the marker and shift a full delta past the original.
      if (line === editLine + 1 && restoredBoundaryComments) {
        const remaining = [...arr];
        for (const c of restoredBoundaryComments) {
          const idx = remaining.indexOf(c);
          if (idx !== -1) {
            remaining.splice(idx, 1);
          }
        }
        arr = remaining;
      }
      if (arr.length > 0) {
        const newLine = line + lineDelta;
        shifted[newLine] = [...(shifted[newLine] ?? []), ...arr];
      }
    }
  }

  // Also shift existing collapse map entries that are after the collapse anchor.
  // Entries AT the anchor (e.g. a partially restored stash) stay put so further
  // expansion can keep restoring from them; later ones move with the edit. Keyed
  // on `collapseLine` (not `editLine`) so a stash held at the new line 1 isn't
  // mistakenly shifted at the top of the file, where `editLine` is 0.
  const shiftedCollapseMap: CollapseMap = {};
  for (const [lineStr, entries] of Object.entries(collapseMap)) {
    const line = Number(lineStr);
    if (line <= collapseLine) {
      shiftedCollapseMap[line] = entries;
    } else {
      shiftedCollapseMap[line + lineDelta] = entries;
    }
  }
  collapseMap = shiftedCollapseMap;

  if (newCollapsed.length > 0) {
    collapseMap[collapseLine] = [...(collapseMap[collapseLine] ?? []), ...newCollapsed];
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
            ...entry,
            source: extraSource,
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
