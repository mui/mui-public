import type { Element, ElementContent, Properties } from 'hast';
import type { FrameRange } from './calculateFrameRanges';

/**
 * Creates a HAST frame element (`span.frame`) with the given children and optional metadata.
 *
 * Used by both `addLineGutters` (initial frame creation) and `restructureFrames`
 * (splitting/rebuilding frames for highlighting or comment extraction).
 */
export function createFrame(
  children: Array<ElementContent>,
  frameType?: FrameRange['type'],
  indentLevel?: number,
  truncated?: FrameRange['truncated'],
): Element {
  const properties: Properties = {
    className: 'frame',
    dataLined: '',
  };

  if (frameType && frameType !== 'normal') {
    properties.dataFrameType = frameType;
  }

  // Set indent level on region frames (highlighted or focus, focused or unfocused)
  if (
    (frameType === 'highlighted' ||
      frameType === 'highlighted-unfocused' ||
      frameType === 'focus' ||
      frameType === 'focus-unfocused') &&
    indentLevel !== undefined
  ) {
    properties.dataFrameIndent = indentLevel;
  }

  if (truncated) {
    properties.dataFrameTruncated = truncated;
  }

  return {
    type: 'element',
    tagName: 'span',
    properties,
    children,
  };
}
