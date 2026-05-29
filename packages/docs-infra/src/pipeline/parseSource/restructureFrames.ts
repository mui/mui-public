import type { Element, ElementContent, RootContent } from 'hast';
import type { HastRoot } from '../../CodeHighlighter/types';
import type { FrameRange } from './calculateFrameRanges';
import { createFrame } from './createFrame';

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
 * A collapsed-lines placeholder span (`<span class="collapse" data-lines={n}>`)
 * along with its anchor line numbers. Tracking both the preceding and
 * following line lets the emitter re-attach the placeholder to whichever
 * neighbor survives the new frame ranges, instead of silently dropping it
 * when the preceding line is filtered out.
 */
interface PlaceholderEntry {
  element: Element;
  /** Line number of the preceding `.line`, if any. */
  prevLine?: number;
  /** Line number of the following `.line`, if any. */
  nextLine?: number;
}

function isCollapsedLinesPlaceholder(node: ElementContent | RootContent): node is Element {
  return (
    node.type === 'element' &&
    node.tagName === 'span' &&
    node.properties != null &&
    node.properties.className === 'collapse'
  );
}

/**
 * Flattens all line elements and collapsed-lines placeholders from existing
 * frames. This is a flat iteration over root.children (frames) and their
 * direct children (lines + newline text nodes + placeholders). Not a deep
 * recursive traversal.
 */
function flattenLineEntries(root: HastRoot): {
  lineEntries: LineEntry[];
  placeholderEntries: PlaceholderEntry[];
} {
  const lineEntries: LineEntry[] = [];
  const placeholderEntries: PlaceholderEntry[] = [];
  // Placeholders that have seen their `prevLine` (or none) but not yet
  // their `nextLine`. Resolved when the next `.line` appears.
  let pendingNextAnchor: PlaceholderEntry[] = [];
  let lastLineNumber: number | undefined;

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
        const lineNumber = child.properties.dataLn;
        // Resolve any placeholders waiting on a following line.
        for (const pending of pendingNextAnchor) {
          pending.nextLine = lineNumber;
        }
        pendingNextAnchor = [];

        const entry: LineEntry = {
          lineNumber,
          element: child,
        };

        // Check if the next child is a trailing newline text node
        const next = children[i + 1];
        if (next && next.type === 'text' && /^[\r\n]+$/.test(next.value)) {
          entry.trailingNewline = next;
          i += 1; // Skip the newline in the next iteration
        }

        lineEntries.push(entry);
        lastLineNumber = lineNumber;
      } else if (isCollapsedLinesPlaceholder(child)) {
        const entry: PlaceholderEntry = {
          element: child,
          prevLine: lastLineNumber,
        };
        placeholderEntries.push(entry);
        pendingNextAnchor.push(entry);
      }
    }
  }

  return { lineEntries, placeholderEntries };
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
  // Step 1: Flatten all lines + placeholders from existing frames.
  const { lineEntries, placeholderEntries } = flattenLineEntries(root);

  // Build a lookup from line number to entry for O(1) access
  const lineEntryMap = new Map<number, LineEntry>();
  for (const entry of lineEntries) {
    lineEntryMap.set(entry.lineNumber, entry);
  }

  // Step 2: Pre-compute the set of kept line numbers so each placeholder
  // can decide where it belongs without re-scanning the ranges.
  const keptLines = new Set<number>();
  for (const range of frameRanges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      keptLines.add(line);
    }
  }

  // Track which placeholders have been emitted to avoid duplicates when
  // both anchors are kept across separate ranges.
  const emittedPlaceholders = new Set<PlaceholderEntry>();

  // Index placeholders by their anchor line for O(1) lookup during emission.
  const placeholdersAfterLine = new Map<number, PlaceholderEntry[]>();
  const placeholdersBeforeLine = new Map<number, PlaceholderEntry[]>();
  for (const placeholder of placeholderEntries) {
    if (placeholder.prevLine !== undefined && keptLines.has(placeholder.prevLine)) {
      // Prefer attaching to the preceding kept line (source-order stable).
      const list = placeholdersAfterLine.get(placeholder.prevLine) ?? [];
      list.push(placeholder);
      placeholdersAfterLine.set(placeholder.prevLine, list);
    } else if (placeholder.nextLine !== undefined && keptLines.has(placeholder.nextLine)) {
      // Preceding anchor was dropped; fall back to the next kept line.
      const list = placeholdersBeforeLine.get(placeholder.nextLine) ?? [];
      list.push(placeholder);
      placeholdersBeforeLine.set(placeholder.nextLine, list);
    }
    // Otherwise: neither anchor survives → placeholder is dropped.
  }

  // Step 3: Build new frames.
  const newFrames: RootContent[] = [];

  for (const range of frameRanges) {
    const children: ElementContent[] = [];

    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const entry = lineEntryMap.get(line);
      if (!entry) {
        continue;
      }

      // Emit any placeholders whose preceding anchor was dropped and that
      // are anchored before this line.
      const before = placeholdersBeforeLine.get(line);
      if (before) {
        for (const placeholder of before) {
          if (!emittedPlaceholders.has(placeholder)) {
            children.push(placeholder.element);
            emittedPlaceholders.add(placeholder);
          }
        }
      }

      children.push(entry.element);

      // Always add trailing newline when present to preserve original line breaks
      if (entry.trailingNewline) {
        children.push(entry.trailingNewline);
      }

      // Re-emit placeholders that originally followed this line.
      const after = placeholdersAfterLine.get(line);
      if (after) {
        for (const placeholder of after) {
          if (!emittedPlaceholders.has(placeholder)) {
            children.push(placeholder.element);
            emittedPlaceholders.add(placeholder);
          }
        }
      }
    }

    // Only create frame if it has children
    if (children.length > 0) {
      const indentLevel =
        range.regionIndex !== undefined ? regionIndentLevels.get(range.regionIndex) : undefined;

      newFrames.push(createFrame(children, range.type, indentLevel, range.truncated));
    }
  }

  // Step 4: Replace root children
  root.children = newFrames;
}
