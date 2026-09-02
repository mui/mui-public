import type { Element } from 'hast';
import type { FrameRange } from '../parseSource/calculateFrameRanges';
import { COLLAPSED_VISIBLE_FRAME_TYPES } from '../parseSource/frameVisibility';
import { calculateFrameIndent } from './calculateFrameIndent';

/**
 * Calculates the `data-frame-indent` level of each region frame, keyed by its
 * index in `frameRanges`.
 *
 * Frames shown while collapsed form one contiguous window and share its indent,
 * so shifting each of them by its own level keeps their left edges aligned.
 * Hidden region frames use the indent of their whole region instead:
 *
 *   focus                 1–2 ─┐
 *   highlighted           3    ├─ window: min indent of lines 1–4
 *   focus                 4   ─┘
 *   normal                5–6    (no indent)
 *   highlighted-unfocused 7–8 ── region: min indent of lines 7–8
 *
 * @param frameRanges - Ordered frame ranges covering the source
 * @param lineElements - Map of line numbers to their line elements
 */
export function calculateFrameIndentLevels(
  frameRanges: FrameRange[],
  lineElements: Map<number, Element>,
): Map<number, number> {
  const frameIndentLevels = new Map<number, number>();
  const windowFrames: number[] = [];
  const windowLines: Element[] = [];
  const regionFrames = new Map<number, number[]>();
  const regionLines = new Map<number, Element[]>();

  function collectLines(range: FrameRange): Element[] {
    const lines: Element[] = [];
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const element = lineElements.get(line);
      if (element) {
        lines.push(element);
      }
    }
    return lines;
  }

  for (let frameIndex = 0; frameIndex < frameRanges.length; frameIndex += 1) {
    const range = frameRanges[frameIndex];

    if (COLLAPSED_VISIBLE_FRAME_TYPES.has(range.type)) {
      windowFrames.push(frameIndex);
      windowLines.push(...collectLines(range));
      continue;
    }

    if (range.regionIndex === undefined) {
      continue;
    }

    regionFrames.set(range.regionIndex, [
      ...(regionFrames.get(range.regionIndex) ?? []),
      frameIndex,
    ]);
    regionLines.set(range.regionIndex, [
      ...(regionLines.get(range.regionIndex) ?? []),
      ...collectLines(range),
    ]);
  }

  for (const [regionIndex, frames] of regionFrames) {
    const indentLevel = calculateFrameIndent(regionLines.get(regionIndex) ?? []);
    for (const frameIndex of frames) {
      frameIndentLevels.set(frameIndex, indentLevel);
    }
  }

  if (windowFrames.length > 0) {
    const indentLevel = calculateFrameIndent(windowLines);
    for (const frameIndex of windowFrames) {
      frameIndentLevels.set(frameIndex, indentLevel);
    }
  }

  return frameIndentLevels;
}
