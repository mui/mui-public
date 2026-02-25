import type { Element, ElementContent, Properties, RootContent } from 'hast';
import type { HastRoot } from '../../CodeHighlighter/types';
import type { FrameRange } from './calculateFrameRanges';

/**
 * Represents a line element and its trailing newline text node (if any).
 */
interface LineEntry {
  /** The line number (1-based) */
  lineNumber: number;
  /** The line element */
  element: Element;
  /** The trailing newline text node after this line, if any */
  trailingNewline?: ElementContent;
}

/**
 * Flattens all line elements from existing frames into a single ordered array.
 * This is a flat iteration over root.children (frames) and their direct children
 * (lines + newline text nodes). Not a deep recursive traversal.
 *
 * @param root - The HAST root node
 * @returns Ordered array of line entries
 */
function flattenLineEntries(root: HastRoot): LineEntry[] {
  const entries: LineEntry[] = [];

  for (const frame of root.children) {
    if (frame.type !== 'element' || frame.tagName !== 'span') {
      continue;
    }

    const children = frame.children ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (
        child.type === 'element' &&
        child.tagName === 'span' &&
        child.properties?.className === 'line' &&
        typeof child.properties.dataLn === 'number'
      ) {
        const entry: LineEntry = {
          lineNumber: child.properties.dataLn,
          element: child,
        };

        // Check if the next child is a trailing newline text node
        const next = children[i + 1];
        if (next && next.type === 'text' && /^[\r\n]+$/.test(next.value)) {
          entry.trailingNewline = next;
          i += 1; // Skip the newline in the next iteration
        }

        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Creates a new frame element with the given properties.
 */
function createFrameElement(
  children: ElementContent[],
  startLine: number,
  endLine: number,
  frameType: FrameRange['type'],
  indentLevel?: number,
): RootContent {
  const properties: Properties = {
    className: 'frame',
    dataFrameStartLine: startLine,
    dataFrameEndLine: endLine,
  };

  // Only set data-frame-type for non-normal frames
  if (frameType !== 'normal') {
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
    type: 'element' as const,
    tagName: 'span',
    properties,
    children,
  };
}

/**
 * Restructures the HAST frame tree based on computed frame ranges.
 *
 * This function flattens all existing frame children into a single ordered array,
 * then redistributes them into new frames based on the provided frame ranges.
 * It's a flat iteration (not a deep recursive traversal) since the HAST structure
 * is always Root → Frame(s) → Line(s).
 *
 * @param root - The HAST root node to restructure (mutated in place)
 * @param frameRanges - Ordered array of frame ranges
 * @param regionIndentLevels - Map of highlighted region index to indent level
 */
export function restructureFrames(
  root: HastRoot,
  frameRanges: FrameRange[],
  regionIndentLevels: Map<number, number>,
): void {
  // Step 1: Flatten all lines from existing frames
  const lineEntries = flattenLineEntries(root);

  // Build a lookup from line number to entry for O(1) access
  const lineEntryMap = new Map<number, LineEntry>();
  for (const entry of lineEntries) {
    lineEntryMap.set(entry.lineNumber, entry);
  }

  // Step 2: Track which highlighted region index each frame range belongs to
  let highlightedRegionIndex = 0;

  // Step 3: Build new frames
  const newFrames: RootContent[] = [];

  for (const range of frameRanges) {
    const children: ElementContent[] = [];

    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const entry = lineEntryMap.get(line);
      if (!entry) {
        continue;
      }

      children.push(entry.element);

      // Always add trailing newline when present to preserve original line breaks
      if (entry.trailingNewline) {
        children.push(entry.trailingNewline);
      }
    }

    // Only create frame if it has children
    if (children.length > 0) {
      const isHighlighted = range.type === 'highlighted' || range.type === 'highlighted-unfocused';
      const indentLevel = isHighlighted
        ? regionIndentLevels.get(highlightedRegionIndex)
        : undefined;

      newFrames.push(
        createFrameElement(children, range.startLine, range.endLine, range.type, indentLevel),
      );
    }

    // Increment region index after each highlighted frame (focused or unfocused)
    if (range.type === 'highlighted' || range.type === 'highlighted-unfocused') {
      highlightedRegionIndex += 1;
    }
  }

  // Step 4: Replace root children
  root.children = newFrames;
}
