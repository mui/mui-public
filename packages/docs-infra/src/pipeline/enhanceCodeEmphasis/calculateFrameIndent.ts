import type { Element } from 'hast';

const INDENT_SIZE = 2;

/**
 * Counts leading spaces in an element by walking the HAST tree.
 *
 * Returns the number of leading space characters before the first
 * non-space character, or -1 if the line is empty/whitespace-only.
 * Only counts space characters. Tab indentation is not supported
 * since the input is HAST output from starry-night which uses spaces.
 */
function countLeadingSpaces(element: Element): number {
  let spaces = 0;

  function walk(node: Element): boolean {
    for (const child of node.children) {
      if (child.type === 'text') {
        for (const char of child.value) {
          if (char === ' ') {
            spaces += 1;
          } else {
            return true;
          }
        }
      } else if (child.type === 'element') {
        if (walk(child)) {
          return true;
        }
      }
    }
    return false;
  }

  const foundNonSpace = walk(element);
  return foundNonSpace ? spaces : -1;
}

/**
 * Calculates the shared indent level for a set of line elements.
 *
 * Finds the minimum leading whitespace across all non-empty lines,
 * then divides by the indent size (2 spaces) and floors to get
 * the indent level.
 *
 * @param lineElements - Array of HAST line elements to analyze
 * @returns The shared indent level (e.g., 2 for 4 leading spaces with 2-space indent)
 */
export function calculateFrameIndent(lineElements: Element[]): number {
  let minLeadingSpaces = Infinity;

  for (const element of lineElements) {
    const leadingSpaces = countLeadingSpaces(element);

    // Skip empty/whitespace-only lines
    if (leadingSpaces === -1) {
      continue;
    }

    if (leadingSpaces < minLeadingSpaces) {
      minLeadingSpaces = leadingSpaces;
    }
  }

  if (minLeadingSpaces === Infinity) {
    return 0;
  }

  return Math.floor(minLeadingSpaces / INDENT_SIZE);
}
