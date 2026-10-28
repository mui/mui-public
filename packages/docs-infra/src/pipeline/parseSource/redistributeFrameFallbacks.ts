import type { ElementContent } from 'hast';

/**
 * A frame's precomputed plain-text fallback together with the inclusive
 * 1-based source line range it covers.
 *
 * `nodes` is the `frame.data.fallback` array — usually a single text node
 * whose concatenated value equals the frame's rendered plain text (with a
 * trailing newline on every line except the final line of the source).
 */
export interface FrameFallback {
  startLine: number;
  endLine: number;
  nodes: ElementContent[];
}

/**
 * A new frame's target line range (inclusive, 1-based).
 */
export interface FrameRangeBounds {
  startLine: number;
  endLine: number;
}

/**
 * Redistributes existing per-frame fallback node arrays onto a new set of
 * frame line ranges, shifting only the lines that cross a frame boundary.
 *
 * Enhancers never change the plain-text output of the code (they only add or
 * modify highlighting spans), so when a frame's line range is unchanged its
 * fallback is reused by reference without scanning. Only the boundary frames —
 * where lines move into an adjacent frame — are split, and the split walks just
 * the lines that need to move (counting newlines with an early exit) rather
 * than splitting the whole frame or re-deriving text via `toText`.
 *
 * Lines that fall in a gap between ranges (collapsed / dropped lines) have
 * their fallback text discarded.
 *
 * `oldFrames` must be ordered ascending and non-overlapping (gaps are allowed,
 * e.g. when a previous restructure already dropped lines); `ranges` must be
 * ordered ascending. Returns one node array per range, in range order.
 */
export function redistributeFrameFallbacks(
  oldFrames: FrameFallback[],
  ranges: FrameRangeBounds[],
): ElementContent[][] {
  const result: ElementContent[][] = [];
  // Index of the first old frame that might overlap the current range. Old
  // frames are ascending, ranges are ascending, so this only moves forward.
  let frameIndex = 0;

  for (const range of ranges) {
    // Skip old frames that end before this range begins.
    while (frameIndex < oldFrames.length && oldFrames[frameIndex].endLine < range.startLine) {
      frameIndex += 1;
    }

    const out: ElementContent[] = [];
    let cursor = frameIndex;
    while (cursor < oldFrames.length && oldFrames[cursor].startLine <= range.endLine) {
      const frame = oldFrames[cursor];
      const overlapStart = Math.max(range.startLine, frame.startLine);
      const overlapEnd = Math.min(range.endLine, frame.endLine);

      if (overlapStart === frame.startLine && overlapEnd === frame.endLine) {
        // Whole frame falls inside this range — reuse its nodes without scanning.
        for (const node of frame.nodes) {
          out.push(node);
        }
      } else {
        // Partial frame — take only the lines that belong to this range.
        const skipLines = overlapStart - frame.startLine;
        const takeLines = overlapEnd - overlapStart + 1;
        for (const node of sliceFrameLines(frame.nodes, skipLines, takeLines)) {
          out.push(node);
        }
      }

      cursor += 1;
    }

    result.push(out);
  }

  return result;
}

/**
 * Extracts `takeLines` lines starting after `skipLines` lines from a frame's
 * fallback node array. Lines are delimited by `\n`; a line includes its
 * trailing newline. The scan exits as soon as `takeLines` newlines have been
 * collected, so it never walks past the lines it needs.
 *
 * Text nodes are split at line boundaries; any non-text node encountered while
 * collecting is passed through whole (it contributes no newline).
 */
function sliceFrameLines(
  nodes: ElementContent[],
  skipLines: number,
  takeLines: number,
): ElementContent[] {
  const out: ElementContent[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      out.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  let collecting = skipLines === 0;
  let skipped = 0;
  let taken = 0;

  for (const node of nodes) {
    if (node.type !== 'text') {
      if (collecting) {
        flush();
        out.push(node);
      }
      continue;
    }

    const { value } = node;
    let pos = 0;
    while (pos < value.length) {
      if (!collecting) {
        const newlineIndex = value.indexOf('\n', pos);
        if (newlineIndex === -1) {
          // No newline left in this node; the remainder belongs to the line
          // still being skipped.
          pos = value.length;
          break;
        }
        skipped += 1;
        pos = newlineIndex + 1;
        if (skipped === skipLines) {
          collecting = true;
        }
        continue;
      }

      const newlineIndex = value.indexOf('\n', pos);
      if (newlineIndex === -1) {
        // Final line of the source (no trailing newline) — take the remainder.
        buffer += value.slice(pos);
        pos = value.length;
        break;
      }
      buffer += value.slice(pos, newlineIndex + 1);
      taken += 1;
      pos = newlineIndex + 1;
      if (taken === takeLines) {
        flush();
        return out;
      }
    }
  }

  flush();
  return out;
}
