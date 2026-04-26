// Example copied from https://github.com/wooorm/starry-night#example-adding-line-numbers

import type { Element, ElementContent, RootContent, Root } from 'hast';
import { createFrame } from './createFrame';
import { getHastTextContent } from '../hastUtils';

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

  // If there are multiple frames and sourceLines provided, add dataAsString to each frame.
  // Derive the text from the frame's own HAST children rather than from
  // sourceLines.join('\n'). The latter produces N-1 separator newlines for N
  // lines, but the frame's HAST carries N newlines worth of content (non-blank
  // lines are followed by a separator text node, blank lines carry the newline
  // inside the `.line` span). Using sourceLines.join('\n') drops exactly one
  // trailing '\n' per frame relative to the highlighted render, which causes
  // a layout shift during lazy hydration when a frame toggles between its
  // plain-text fallback and its highlighted output.
  if (replacement.length > 1 && sourceLines) {
    for (const frame of replacement) {
      if (
        frame.type === 'element' &&
        frame.tagName === 'span' &&
        frame.properties?.className === 'frame'
      ) {
        const hasLine = frame.children.some(
          (c) => c.type === 'element' && c.properties?.className === 'line',
        );
        if (hasLine) {
          frame.properties.dataAsString = getHastTextContent(frame);
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
  (tree.data as any).totalLines = lineNumber;
  // Store the frame size used for splitting so downstream enhancers can match it
  if (replacement.length > 1) {
    (tree.data as any).frameSize = frameSize;
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
