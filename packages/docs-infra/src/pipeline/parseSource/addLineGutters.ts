// Example copied from https://github.com/wooorm/starry-night#example-adding-line-numbers

import type { ElementContent, RootContent, Root } from 'hast';

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
  let frameLines: Array<RootContent> = [];
  let frameStartLine = 1; // Track the starting line number for the current frame

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
        frameLines.push(createLine(line, lineNumber), {
          type: 'text',
          value: match[0],
        });

        // Check if we need to create a frame (only if sourceLines provided, otherwise keep everything in one frame)
        if (sourceLines && lineNumber % frameSize === 0) {
          replacement.push(createFrame(frameLines, sourceLines, frameStartLine, lineNumber));
          frameLines = [];
          frameStartLine = lineNumber + 1;
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
    replacement.push(createFrame(frameLines, sourceLines, frameStartLine, lineNumber));
  }

  // If there are multiple frames and sourceLines provided, add dataAsString to each frame
  if (replacement.length > 1 && sourceLines) {
    for (const frame of replacement) {
      if (
        frame.type === 'element' &&
        frame.tagName === 'span' &&
        frame.properties?.className === 'frame' &&
        typeof frame.properties.dataFrameStartLine === 'number' &&
        typeof frame.properties.dataFrameEndLine === 'number'
      ) {
        const startLine = frame.properties.dataFrameStartLine - 1; // Convert to 0-based index
        const endLine = frame.properties.dataFrameEndLine; // This is already inclusive
        frame.properties.dataAsString = sourceLines.slice(startLine, endLine).join('\n');
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
}

function createLine(children: Array<ElementContent>, line: number): RootContent {
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

function createFrame(
  frameChildren: Array<RootContent>,
  sourceLines?: string[],
  startLine?: number,
  endLine?: number,
): RootContent {
  const properties: any = {
    className: 'frame',
  };

  // Store line range information if provided (for dataAsString generation)
  if (sourceLines && startLine !== undefined && endLine !== undefined) {
    properties.dataFrameStartLine = startLine;
    properties.dataFrameEndLine = endLine;
  }

  return {
    type: 'element' as const,
    tagName: 'span',
    properties,
    children: frameChildren as Array<ElementContent>,
  };
}
