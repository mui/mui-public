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
  startLine?: number,
  endLine?: number,
  frameType?: FrameRange['type'],
  indentLevel?: number,
): Element {
  const properties: Properties = {
    className: 'frame',
  };

  if (startLine !== undefined && endLine !== undefined) {
    properties.dataFrameStartLine = startLine;
    properties.dataFrameEndLine = endLine;
  }

  if (frameType && frameType !== 'normal') {
    properties.dataFrameType = frameType;
  }

  // Set indent level on highlighted frames (focused or unfocused)
  if (
    (frameType === 'highlighted' || frameType === 'highlighted-unfocused') &&
    indentLevel !== undefined
  ) {
    properties.dataFrameIndent = indentLevel;
  }

  return {
    type: 'element',
    tagName: 'span',
    properties,
    children,
  };
}
