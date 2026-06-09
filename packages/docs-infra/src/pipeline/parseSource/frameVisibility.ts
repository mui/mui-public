import type { FrameRange } from './calculateFrameRanges';

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
