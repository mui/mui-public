import type { Nodes, Root, Element } from 'hast';

/**
 * Frame `data-frame-type` values that remain rendered when a code block is
 * in its collapsed (un-expanded) state. Must stay in sync with
 * `INITIAL_VISIBLE_FRAME_TYPES` in `useCode/Pre.tsx`.
 */
const INITIAL_VISIBLE_FRAME_TYPES = new Set([
  'highlighted',
  'focus',
  'padding-top',
  'padding-bottom',
]);

/**
 * Returns the set of 1-indexed source line numbers that are visible when
 * the rendered code block is collapsed (i.e. the user hasn't clicked
 * "expand"). Mirrors the visibility rule applied at runtime by `<Pre>`:
 *
 *   - Frames whose `data-frame-type` is `'highlighted'`, `'focus'`,
 *     `'padding-top'`, or `'padding-bottom'` are visible.
 *   - When no such emphasis frame exists, only the first frame is shown
 *     (this matches `getInitialVisibleFrames` in `<Pre>`).
 *
 * `tree` must be the output of `parseSource` (a `Root` whose top-level
 * children are frame `Element`s with `'line'` `Element` descendants).
 * Returns an empty set for an empty/invalid tree.
 */
export function getInitialVisibleSourceLines(tree: Nodes): Set<number> {
  const visible = new Set<number>();
  if (tree.type !== 'root') {
    return visible;
  }
  const root = tree as Root;

  let lineNumber = 0;
  let hasVisibleEmphasisFrame = false;
  // First pass: collect lines under explicitly-visible emphasis frames.
  for (const child of root.children) {
    if (child.type !== 'element' || (child as Element).properties?.className !== 'frame') {
      continue;
    }
    const frame = child as Element;
    const frameType = frame.properties?.dataFrameType;
    const frameVisible =
      typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType);
    if (frameVisible) {
      hasVisibleEmphasisFrame = true;
    }
    for (const grandChild of frame.children) {
      if (
        grandChild.type === 'element' &&
        (grandChild as Element).properties?.className === 'line'
      ) {
        lineNumber += 1;
        if (frameVisible) {
          visible.add(lineNumber);
        }
      }
    }
  }

  // Fallback: no emphasis frame in the source — the first frame is the
  // one shown when collapsed. Add its lines.
  if (!hasVisibleEmphasisFrame && lineNumber > 0) {
    let fallbackLine = 0;
    for (const child of root.children) {
      if (child.type !== 'element' || (child as Element).properties?.className !== 'frame') {
        continue;
      }
      const frame = child as Element;
      for (const grandChild of frame.children) {
        if (
          grandChild.type === 'element' &&
          (grandChild as Element).properties?.className === 'line'
        ) {
          fallbackLine += 1;
          visible.add(fallbackLine);
        }
      }
      // Only the first frame.
      break;
    }
  }

  return visible;
}
