// Example copied from https://github.com/wooorm/starry-night#example-adding-line-numbers

import type { Element, ElementContent, RootContent, Root } from 'hast';
import { createFrame } from './createFrame';
import { isFrameSpan } from './isFrameSpan';

/**
 * Counts the number of lines in a HAST tree without mutating it.
 * Uses the same logic as starryNightGutter but only returns the count.
 * @param tree - The HAST tree to count lines in
 * @returns The number of lines in the tree
 */
export function countLines(tree: Root): number {
  const search = /\r?\n|\r/g;
  let index = -1;
  let start = 0;
  let startTextRemainder = '';
  let lineNumber = 0;

  while (index + 1 < tree.children.length) {
    index += 1;
    const child = tree.children[index];

    if (child.type === 'text') {
      let textStart = 0;
      let match = search.exec(child.value);

      while (match) {
        lineNumber += 1;
        start = index + 1;
        textStart = match.index + match[0].length;
        match = search.exec(child.value);
      }

      // If we matched, make sure to not drop the text after the last line ending.
      if (start === index + 1) {
        startTextRemainder = child.value.slice(textStart);
      }
    }
  }

  // Check if we have remaining content to process as a line
  if (start < tree.children.length || startTextRemainder) {
    lineNumber += 1;
  }

  return lineNumber;
}

export function starryNightGutter(
  tree: Root,
  sourceLines?: string[],
  frameSize: number = 120,
): void {
  /** @type {Array<RootContent>} */
  const replacement: Array<RootContent> = [];
  const search = /\r?\n|\r/g;
  let index = -1;
  let start = 0;
  let startTextRemainder = '';
  let lineNumber = 0;
  let frameLines: Array<ElementContent> = [];

  while (index + 1 < tree.children.length) {
    index += 1;
    const child = tree.children[index];

    if (child.type === 'text') {
      let textStart = 0;
      let match = search.exec(child.value);

      while (match) {
        // Nodes in this line.
        const line: Array<ElementContent> = tree.children.slice(
          start,
          index,
        ) as Array<ElementContent>;

        // Prepend text from a partial matched earlier text.
        if (startTextRemainder) {
          line.unshift({ type: 'text', value: startTextRemainder });
          startTextRemainder = '';
        }

        // Append text from this text.
        if (match.index > textStart) {
          line.push({
            type: 'text',
            value: child.value.slice(textStart, match.index),
          });
        }

        // Add a line, and the eol.
        lineNumber += 1;
        // If the line is empty, include the newline inside the span to avoid empty spans
        if (line.length === 0) {
          line.push({ type: 'text', value: match[0] });
          frameLines.push(createLine(line, lineNumber));
        } else {
          frameLines.push(createLine(line, lineNumber), {
            type: 'text',
            value: match[0],
          });
        }

        // Check if we need to create a frame (only if sourceLines provided, otherwise keep everything in one frame)
        if (sourceLines && lineNumber % frameSize === 0) {
          replacement.push(createFrame(frameLines));
          frameLines = [];
        }

        start = index + 1;
        textStart = match.index + match[0].length;
        match = search.exec(child.value);
      }

      // If we matched, make sure to not drop the text after the last line ending.
      if (start === index + 1) {
        startTextRemainder = child.value.slice(textStart);
      }
    }
  }

  const line: Array<ElementContent> = tree.children.slice(start) as Array<ElementContent>;
  // Prepend text from a partial matched earlier text.
  if (startTextRemainder) {
    line.unshift({ type: 'text', value: startTextRemainder });
    startTextRemainder = '';
  }

  if (line.length > 0) {
    lineNumber += 1;
    frameLines.push(createLine(line, lineNumber));
  }

  // Add any remaining lines as the final frame
  if (frameLines.length > 0) {
    replacement.push(createFrame(frameLines));
  }

  // When `sourceLines` is provided, attach a precomputed `fallback` hast to
  // every frame (including single-frame output).
  //
  // `frame.data.fallback` is a basic hast node array (single `{ type: 'text' }`
  // node) carrying the same text the highlighted hast would render. It is set
  // here, before the enhancer pipeline runs, so enhancers can read and keep it
  // in sync. Enhancers only modify spans (never the plain-text output), so a
  // frame's fallback stays valid unless the frame is restructured — in which
  // case `restructureFrames` shifts the corresponding lines between frames.
  //
  // Downstream, these per-frame fallbacks are collected into the variant-level
  // root fallback and also let the renderer skip running
  // `stripHighlightingSpans` per frame at render time. Every frame except the
  // last covers `frameSize` source lines, each of which was followed by a
  // newline separator in the original source, so its text ends with a trailing
  // '\n'. The final frame only carries a trailing newline if the source itself
  // ends with one. Without this trailing '\n', the plain-text fallback and the
  // highlighted render disagree by exactly one newline per non-final frame,
  // which causes a layout shift during lazy hydration when a frame toggles
  // between the two.
  if (sourceLines) {
    const lastIndex = replacement.length - 1;
    for (let frameIndex = 0; frameIndex < replacement.length; frameIndex += 1) {
      const frame = replacement[frameIndex];
      if (frame.type === 'element' && frame.tagName === 'span' && isFrameSpan(frame)) {
        // Extract line range from child .line elements
        const lineChildren = frame.children.filter(
          (c): c is Element =>
            c.type === 'element' &&
            c.properties?.className === 'line' &&
            typeof c.properties.dataLn === 'number',
        );
        if (lineChildren.length > 0) {
          const startLine = Number(lineChildren[0].properties.dataLn) - 1;
          const endLine = Number(lineChildren[lineChildren.length - 1].properties.dataLn);
          const joined = sourceLines.slice(startLine, endLine).join('\n');
          // Non-final frames are always followed by more content, so their text
          // ends with the line separator. The final frame's text ends with a
          // newline only when the source itself does — mirroring the highlighted
          // render, whose last `.line` span is then followed by a trailing `\n`
          // text node. `sourceLines` has one more entry than `lineNumber` exactly
          // when the source ended with a newline (the empty segment after it
          // never became a line). This keeps the plain-text fallback the same
          // height as the highlighted render (no hydration jump) AND makes the
          // root fallback dictionary an exact match for the raw source text.
          const sourceEndsWithNewline = sourceLines.length > lineNumber;
          const text = frameIndex < lastIndex || sourceEndsWithNewline ? `${joined}\n` : joined;
          // Cast to `ElementData` because `hast-util-from-parse5` augments
          // it with a required `position` field (upstream bug — should be
          // optional). We're not running through that parser here, so the
          // field never exists at runtime.
          if (!frame.data) {
            frame.data = {} as Element['data'] & {};
          }
          frame.data.fallback = [{ type: 'text', value: text }];
        }
      }
    }
  }

  // Replace children with new array.
  tree.children = replacement;

  // Add total line count to root data
  if (!tree.data) {
    tree.data = {};
  }
  tree.data.totalLines = lineNumber;
  // Store the frame size used for splitting so downstream enhancers can match it
  if (replacement.length > 1) {
    tree.data.frameSize = frameSize;
  }
}

function createLine(children: Array<ElementContent>, line: number): Element {
  return {
    type: 'element' as const,
    tagName: 'span',
    properties: {
      className: 'line',
      dataLn: line,
    },
    children,
  };
}
