import type { ElementContent } from 'hast';
import type { FrameRange } from './calculateFrameRanges';
import type { HastRoot } from '../../CodeHighlighter/types';
import { hasClassName, isFrameSpan } from './isFrameSpan';

/**
 * The `data-frame-type` values whose frames make up the window a collapsible
 * code block shows while collapsed (the contiguous focused window:
 * `padding-top`, `highlighted` / `focus`, `padding-bottom`).
 *
 * This is the single source of truth shared by the runtime visibility rule in
 * `useCode/Pre.tsx`, the collapsed fallback reducer in
 * `CodeHighlighter/fallbackFormat.ts`, and the collapsed line computation in
 * `pipeline/loadIsomorphicCodeVariant/getInitialVisibleSourceLines.ts`. It is
 * intentionally isomorphic (no client-only code) so the server and the client
 * stay in sync.
 */
const COLLAPSED_VISIBLE_FRAME_TYPE_LIST: readonly FrameRange['type'][] = [
  'highlighted',
  'focus',
  'padding-top',
  'padding-bottom',
];

/**
 * Set form of {@link COLLAPSED_VISIBLE_FRAME_TYPE_LIST} for fast membership
 * checks. Typed as `ReadonlySet<string>` so callers can pass a raw
 * `data-frame-type` string to `.has()` without narrowing first.
 */
export const COLLAPSED_VISIBLE_FRAME_TYPES: ReadonlySet<string> = new Set(
  COLLAPSED_VISIBLE_FRAME_TYPE_LIST,
);

/**
 * Runtime "collapse to empty" frame-type rewrite.
 *
 * `collapseToEmpty` is a render-time option (it never touches the precomputed
 * HAST) that makes a collapsible code block render with an *empty* collapsed
 * window — the whole block is hidden until the reader expands it. It works by
 * demoting every collapsed-visible frame type to a hidden equivalent so the
 * existing collapse CSS (which only shows {@link COLLAPSED_VISIBLE_FRAME_TYPES}
 * while collapsed) hides everything:
 *
 * - `focus` → `focus-unfocused`
 * - `highlighted` → `highlighted-unfocused`
 * - `padding-top` / `padding-bottom` → `normal`
 *
 * The `-unfocused` variants are kept (rather than `normal`) for `focus` /
 * `highlighted` so the highlight styling is still present once the block is
 * expanded. Padding frames carry no styling, so they become `normal`.
 *
 * Frame types that are already hidden (or non-region, e.g. `comment`) are
 * returned unchanged. Returns the input untouched when `collapseToEmpty` is false.
 *
 * @param frameType - The frame's `data-frame-type` (may be `undefined` for `normal`)
 * @param collapseToEmpty - Whether the block is rendered collapse-to-empty
 */
export function resolveCollapsedFrameType(
  frameType: string | undefined,
  collapseToEmpty: boolean,
): string | undefined {
  if (!collapseToEmpty) {
    return frameType;
  }
  switch (frameType) {
    case 'focus':
      return 'focus-unfocused';
    case 'highlighted':
      return 'highlighted-unfocused';
    case 'padding-top':
    case 'padding-bottom':
      return 'normal';
    default:
      return frameType;
  }
}

/**
 * The set of frame indices that are visible on the initial (collapsed) render of
 * a code block: the contiguous focused window
 * ({@link COLLAPSED_VISIBLE_FRAME_TYPES}), falling back to the first frame when no
 * frame carries an emphasis type. Returns an empty set for `collapseToEmpty` (an
 * empty collapsed window) and for a `focusedLines === 0` carve-out
 * (`oversizedFocus: 'hide'`).
 *
 * Shared by the runtime rule in `useCode/Pre.tsx` and the server-side
 * highlighted-visible fallback builder, so the frames highlighted on the first
 * paint match exactly. Isomorphic — reads only precomputed HAST attributes.
 */
export function getInitialVisibleFrames(
  hast: HastRoot | null,
  collapseToEmpty = false,
): { [key: number]: boolean } {
  if (!hast) {
    return collapseToEmpty ? {} : { 0: true };
  }

  // Collapse-to-empty renders an empty collapsed window — no frame is visible while
  // collapsed, regardless of the precomputed frame types.
  if (collapseToEmpty) {
    return {};
  }

  const visibleFrames: { [key: number]: boolean } = {};
  let frameIndex = 0;
  let hasVisibleEmphasisFrame = false;

  hast.children.forEach((child) => {
    if (child.type !== 'element' || !isFrameSpan(child)) {
      return;
    }

    const frameType = child.properties.dataFrameType;
    if (typeof frameType === 'string' && COLLAPSED_VISIBLE_FRAME_TYPES.has(frameType)) {
      visibleFrames[frameIndex] = true;
      hasVisibleEmphasisFrame = true;
    }

    frameIndex += 1;
  });

  // Collapse-to-nothing (oversizedFocus: 'hide'): `focusedLines === 0` means
  // the collapsed window is intentionally empty, so skip the first-frame
  // fallback and keep every frame hidden when collapsed.
  if (hast.data?.focusedLines === 0) {
    return visibleFrames;
  }

  if (!hasVisibleEmphasisFrame && frameIndex > 0) {
    visibleFrames[0] = true;
  }

  return visibleFrames;
}

/**
 * Counts newlines in a hast subtree and reports whether the tree's text content
 * ends with a newline. Walks text nodes directly instead of materializing the
 * subtree into a string — avoids the O(N) allocation `hast-util-to-text`
 * performs per call, which adds up across hundreds of frames in large blocks.
 *
 * Returns `[newlineCount, endsWithNewline]`. `endsWithNewline` is `false` for an
 * empty subtree.
 */
function countFrameNewlines(node: ElementContent | HastRoot): [number, boolean] {
  let count = 0;
  let endsWithNewline = false;
  let sawText = false;

  const walk = (current: { type: string; value?: unknown; children?: unknown }): void => {
    if (current.type === 'text') {
      const value = current.value as string;
      if (value.length === 0) {
        return;
      }
      sawText = true;
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10 /* \n */) {
          count += 1;
        }
      }
      endsWithNewline = value.charCodeAt(value.length - 1) === 10;
      return;
    }
    if (Array.isArray(current.children)) {
      const children = current.children;
      for (let i = 0; i < children.length; i += 1) {
        walk(children[i] as ElementContent);
      }
    }
  };

  walk(node);
  return [count, sawText && endsWithNewline];
}

/** {@link countFrameNewlines} without the trailing-newline flag. */
function countFrameNewlinesOnly(node: ElementContent | HastRoot): number {
  return countFrameNewlines(node)[0];
}

/**
 * The region a collapsible code block shows while collapsed, in both of the
 * coordinate systems its consumers need: rendered rows (for caret bounds) and
 * source line numbers (for an editable projection).
 */
export type CollapsedFrameWindow = {
  /** First and last rendered row of the visible region. */
  minRow: number;
  maxRow: number;
  /**
   * First and last 1-indexed source line of the visible region, read from the
   * line spans' `data-ln`. `undefined` when the frames carry no line numbers.
   */
  minLine?: number;
  maxLine?: number;
  /**
   * Whether the visible line numbers run without a gap. A projection needs a
   * contiguous slice; caret bounds do not care.
   */
  contiguousLines: boolean;
  /**
   * Smallest `data-frame-indent` across the visible frames, in indent units.
   * `undefined` when no visible frame is indented.
   */
  minIndent?: number;
};

/**
 * Walks the collapsed-visible frames once and reports the window they cover.
 *
 * This is the single derivation of "what does the collapsed view show": the
 * caret bounds in `useCode/Pre.tsx` and the focus-derived source projection both
 * read it, so the region the editor edits and the region the caret is held
 * inside can never disagree.
 *
 * Returns `undefined` when the block is not collapsible, when it renders an
 * empty collapsed window, or when no frame is visible while collapsed.
 */
export function getCollapsedFrameWindow(
  hast: HastRoot | null,
  collapseToEmpty = false,
): CollapsedFrameWindow | undefined {
  // Collapse-to-empty has no visible-when-collapsed region. The original frame
  // types survive here (only their *rendered* type is rewritten), so this has to
  // be checked explicitly rather than inferred from the frames.
  if (collapseToEmpty || !hast || hast.data?.collapsible !== true) {
    return undefined;
  }

  let minIndent: number | undefined;
  let minRow: number | undefined;
  let maxRow: number | undefined;
  let minLine: number | undefined;
  let maxLine: number | undefined;
  let lineCount = 0;
  let row = 0;

  for (const child of hast.children) {
    if (child.type !== 'element' || !isFrameSpan(child)) {
      continue;
    }
    const frameType = child.properties.dataFrameType;
    const indent = child.properties.dataFrameIndent;
    const isVisibleWhenCollapsed =
      typeof frameType === 'string' && COLLAPSED_VISIBLE_FRAME_TYPES.has(frameType);

    if (!isVisibleWhenCollapsed) {
      // Past the visible region, hidden frames cannot change any output.
      if (maxRow !== undefined) {
        break;
      }
      // Before it, they only need to advance the row counter.
      row += countFrameNewlinesOnly(child);
      continue;
    }

    const [newlines, endsWithNewline] = countFrameNewlines(child);
    const lastContentRow = endsWithNewline ? row + Math.max(0, newlines - 1) : row + newlines;

    if (minRow === undefined) {
      minRow = row;
    }
    maxRow = lastContentRow;
    if (typeof indent === 'number' && (minIndent === undefined || indent < minIndent)) {
      minIndent = indent;
    }

    for (const line of child.children) {
      if (
        line.type === 'element' &&
        hasClassName(line, 'line') &&
        typeof line.properties.dataLn === 'number'
      ) {
        const ln = line.properties.dataLn;
        lineCount += 1;
        if (minLine === undefined || ln < minLine) {
          minLine = ln;
        }
        if (maxLine === undefined || ln > maxLine) {
          maxLine = ln;
        }
      }
    }

    row += newlines;
  }

  if (minRow === undefined || maxRow === undefined) {
    return undefined;
  }

  return {
    minRow,
    maxRow,
    minLine,
    maxLine,
    contiguousLines:
      minLine !== undefined && maxLine !== undefined && maxLine - minLine + 1 === lineCount,
    minIndent,
  };
}
