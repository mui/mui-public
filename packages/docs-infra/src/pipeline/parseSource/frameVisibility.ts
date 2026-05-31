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
