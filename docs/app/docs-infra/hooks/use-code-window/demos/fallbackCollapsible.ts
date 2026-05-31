import type { HastRoot } from '@mui/internal-docs-infra/CodeHighlighter/types';

/**
 * Re-derive whether a code block is collapsible from its fallback HAST.
 *
 * Mirrors the emphasis enhancer's `markCollapsible`: a block is collapsible
 * when its frames include both a *hidden* frame (a `normal` frame with no
 * `data-frame-type`, or an `*-unfocused` one) and a *visible* frame
 * (`highlighted` / `focus` / `padding-*`). The variant-level fallback root
 * drops `data.collapsible`, but it preserves each frame's `data-frame-type`,
 * so the fallback can decide whether to show the Expand/Collapse toggle
 * (`data-collapsible` on the `<code>`) without it appearing for plain blocks.
 */
export function fallbackHasCollapsibleFrames(root: HastRoot | undefined): boolean {
  if (!root) {
    return false;
  }

  let hasHidden = false;
  let hasVisible = false;

  for (const child of root.children) {
    if (child.type !== 'element') {
      continue;
    }
    const className = child.properties?.className;
    const isFrame =
      className === 'frame' || (Array.isArray(className) && className.includes('frame'));
    if (!isFrame) {
      continue;
    }

    const frameType = child.properties?.dataFrameType;
    if (
      frameType === undefined ||
      frameType === 'highlighted-unfocused' ||
      frameType === 'focus-unfocused'
    ) {
      hasHidden = true;
    } else if (
      frameType === 'highlighted' ||
      frameType === 'focus' ||
      frameType === 'padding-top' ||
      frameType === 'padding-bottom'
    ) {
      hasVisible = true;
    }

    if (hasHidden && hasVisible) {
      return true;
    }
  }

  return false;
}
