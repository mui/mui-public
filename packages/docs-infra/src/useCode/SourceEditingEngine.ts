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
  const len = source.length;
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
  if (!comments || Object.keys(comments).length === 0) {
    return { comments, collapseMap: existingCollapseMap };
  }

  if (lineDelta === 0) {
    return { comments, collapseMap: existingCollapseMap };
  }

  // position.line is 0-indexed in the new text.
  // lineDelta is positive for insertions and negative for deletions.
  // Convert to the 1-indexed line in old text that the cursor was on:
  // For additions (lineDelta > 0):
  //   - Forward typing: position is the POST-edit cursor (extent === 0).
  //     Cursor moved down by lineDelta, so old line = position.line - lineDelta.
  //   - Undo of a multi-line delete: the saved position has extent > 0 and
  //     points to the SELECTION-START in the redone text — i.e. where the
  //     re-inserted lines begin. The "edit line" is that line itself; the
  //     new lines come AFTER it.
  // For deletions (lineDelta < 0): cursor stayed where it was, old line = position.line.
  const isUndoOfMultiLineDelete = lineDelta > 0 && position.extent > 0;
  const editLine = isUndoOfMultiLineDelete
    ? position.line + 1
    : position.line - Math.max(0, lineDelta) + 1; // 1-indexed

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
      //
      // Empty/whitespace-only deleted lines also push their regular comments
      // to editLine + 1: nothing actually shifted upward into editLine, so the
      // highlighted region should shrink rather than expand onto the line above.
      const wasEmptyLine = oldEmptyLineSet?.has(line) ?? false;
      const regular = commentArr.filter((c) => !c.endsWith('-end'));
      const boundary = commentArr.filter((c) => c.endsWith('-end'));

      if (regular.length > 0) {
        if (wasEmptyLine) {
          const target = editLine + 1;
          shifted[target] = [...(shifted[target] ?? []), ...regular];
        } else {
          shifted[editLine] = [...(shifted[editLine] ?? []), ...regular];
          newCollapsed.push({ offset: line - editLine, comments: regular });
        }
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
