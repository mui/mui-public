import type { FrameRange } from './calculateFrameRanges';
import type { HastRoot } from '../../CodeHighlighter/types';
import { isFrameSpan } from './isFrameSpan';

/**
 * The `data-frame-type` values whose frames make up the window a collapsible
 * code block shows while collapsed (the contiguous focused window:
 * `padding-top`, `highlighted` / `focus`, `padding-bottom`).
 *
 * This is the single source of truth shared by the runtime visibility rule in
 * `useCode/Pre.tsx`, the collapsed fallback reducer in
 * `CodeHighlighter/fallbackFormat.ts`, and collapsed source rendering in
 * `useCode/Pre.tsx`. It is intentionally isomorphic (no client-only code) so
 * the server and the client stay in sync.
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
