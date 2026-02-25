import type { Element } from 'hast';

const INDENT_SIZE = 2;

/**
 * Gets the text content of an element recursively.
 */
function getElementText(element: Element): string {
  let text = '';
  for (const child of element.children || []) {
    if (child.type === 'text') {
      text += child.value;
    } else if (child.type === 'element') {
      text += getElementText(child);
    }
  }
  return text;
}

/**
 * Counts leading spaces in a string.
 */
function countLeadingSpaces(text: string): number {
  // Only counts space characters. Tab indentation is not supported since
  // the input is HAST output from starry-night which uses spaces.
  let count = 0;
  for (const char of text) {
    if (char === ' ') {
      count += 1;
    } else {
      break;
    }
  }
  return count;
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
    const text = getElementText(element);

    // Skip empty lines
    if (text.trim().length === 0) {
      continue;
    }

    const leadingSpaces = countLeadingSpaces(text);
    if (leadingSpaces < minLeadingSpaces) {
      minLeadingSpaces = leadingSpaces;
    }
  }

  if (minLeadingSpaces === Infinity) {
    return 0;
  }

  return Math.floor(minLeadingSpaces / INDENT_SIZE);
}
