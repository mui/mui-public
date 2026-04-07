import type { Element, ElementContent } from 'hast';
import type { HastRoot, SourceComments, SourceEnhancer } from '../../CodeHighlighter/types';
import { getHastTextContent } from '../loadServerTypes/hastTypeUtils';
import type { EmphasisMeta, EnhanceCodeEmphasisOptions } from '../parseSource/calculateFrameRanges';
import { calculateFrameRanges } from '../parseSource/calculateFrameRanges';
import { calculateFrameIndent } from './calculateFrameIndent';
import { restructureFrames } from '../parseSource/restructureFrames';

export type {
  EmphasisMeta,
  EnhanceCodeEmphasisOptions,
  FrameRange,
} from '../parseSource/calculateFrameRanges';

/**
 * The prefix used to identify emphasis comments in source code.
 * Comments starting with this prefix will be processed for emphasis.
 */
export const EMPHASIS_COMMENT_PREFIX = '@highlight';

/**
 * Parsed emphasis directive from a comment.
 */
interface EmphasisDirective {
  /** The line number where the directive was found */
  line: number;
  /** Type of directive: 'single' for inline, 'start' for multiline start, 'end' for multiline end, 'text' for inline text highlight */
  type: 'single' | 'start' | 'end' | 'text';
  /** Optional description text after the directive */
  description?: string;
  /** For 'text' type: the texts to highlight within the line */
  highlightTexts?: string[];
  /** Whether this directive is marked as the focus target */
  focus?: boolean;
}

/**
 * Extracts a quoted string from content.
 * Supports both double quotes ("...") and single quotes ('...').
 * Escaped quotes within the string are not supported.
 *
 * @param content - The content to extract the quoted string from
 * @returns The extracted string (without quotes) or undefined if no quoted string found
 */
function extractQuotedString(content: string): string | undefined {
  const match = content.match(/^(["'])(.*)\1$/);
  if (match) {
    return match[2];
  }
  // Also try to find quoted string anywhere in the content
  const anyMatch = content.match(/(["'])([^"']+)\1/);
  return anyMatch?.[2];
}

/**
 * Extracts all quoted strings from content.
 * Supports both double quotes ("...") and single quotes ('...').
 *
 * @param content - The content to extract quoted strings from
 * @returns Array of extracted strings (without quotes), empty if none found
 */
function extractAllQuotedStrings(content: string): string[] {
  const results: string[] = [];
  const regex = /(["'])([^"']+)\1/g;
  let match = regex.exec(content);
  while (match) {
    results.push(match[2]);
    match = regex.exec(content);
  }
  return results;
}
/**
 * Extracts and removes the `@focus` keyword from content.
 *
 * @param content - The content to check for `@focus`
 * @returns An object with `focus` boolean and the `remaining` content with `@focus` removed
 */
function extractFocus(content: string): { focus: boolean; remaining: string } {
  // Match @focus only as a standalone token (not inside quotes)
  const match = content.match(/(^|\s)@focus(\s|$)/);
  if (!match) {
    return { focus: false, remaining: content };
  }
  const start = match.index! + match[1].length;
  const remaining = (content.slice(0, start) + content.slice(start + '@focus'.length)).trim();
  return { focus: true, remaining };
}

/**
 * Parses emphasis comments and returns structured directives.
 *
 * Supported formats:
 * - Single line: `@highlight` or `@highlight "description"`
 * - Single line focused: `@highlight @focus` or `@highlight @focus "description"`
 * - Multiline start: `@highlight-start` or `@highlight-start "description"`
 * - Multiline start focused: `@highlight-start @focus` or `@highlight-start @focus "description"`
 * - Multiline end: `@highlight-end`
 * - Text highlight: `@highlight-text "text to highlight"` or `@highlight-text "one" "two"`
 * - Text highlight focused: `@highlight-text @focus "text to highlight"`
 *
 * @param comments - Source comments keyed by line number
 * @returns Array of parsed emphasis directives
 */
function parseEmphasisDirectives(comments: SourceComments): EmphasisDirective[] {
  const directives: EmphasisDirective[] = [];

  for (const [lineStr, commentArray] of Object.entries(comments)) {
    const line = parseInt(lineStr, 10);

    for (const comment of commentArray) {
      // Check if this is an emphasis comment
      if (!comment.startsWith(EMPHASIS_COMMENT_PREFIX)) {
        continue;
      }

      // Extract the content after "@highlight"
      const content = comment.slice(EMPHASIS_COMMENT_PREFIX.length);

      if (content.startsWith('-end')) {
        // End of multiline emphasis: @highlight-end
        directives.push({ line, type: 'end' });
      } else if (content.startsWith('-start')) {
        // Start of multiline emphasis: @highlight-start or @highlight-start "description"
        const afterStart = content.slice('-start'.length).trim();
        const { focus, remaining: remainingStart } = extractFocus(afterStart);
        const description = extractQuotedString(remainingStart);
        directives.push({
          line,
          type: 'start',
          description,
          focus,
        });
      } else if (content.startsWith('-text')) {
        // Text highlight: @highlight-text "text" or @highlight-text "one" "two" "three"
        const afterText = content.slice('-text'.length).trim();
        const { focus, remaining: remainingText } = extractFocus(afterText);
        const highlightTexts = extractAllQuotedStrings(remainingText);
        if (highlightTexts.length > 0) {
          directives.push({
            line,
            type: 'text',
            highlightTexts,
            focus,
          });
        }
      } else {
        // Single line emphasis: @highlight or @highlight "description"
        const afterHighlight = content.trim();
        const { focus, remaining: remainingSingle } = extractFocus(afterHighlight);
        const description = extractQuotedString(remainingSingle) || undefined;
        directives.push({
          line,
          type: 'single',
          description,
          focus,
        });
      }
    }
  }

  return directives;
}

/**
 * Capitalizes the first letter of a string.
 *
 * @param str - The string to capitalize
 * @returns The string with the first letter capitalized
 */
function capitalize(str: string | undefined): string | undefined {
  if (!str) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Builds a map of line numbers to their line elements from the HAST tree.
 * This allows O(1) lookups instead of traversing the tree for each lookup.
 *
 * @param node - The HAST node to search
 * @returns Map of line numbers to their line elements
 */
function buildLineElementMap(node: HastRoot | Element): Map<number, Element> {
  const map = new Map<number, Element>();

  function traverse(n: HastRoot | Element): void {
    if (!('children' in n) || !n.children) {
      return;
    }

    for (const child of n.children) {
      if (child.type !== 'element') {
        continue;
      }

      // Check if this is a line element
      if (
        child.tagName === 'span' &&
        child.properties?.className === 'line' &&
        typeof child.properties.dataLn === 'number'
      ) {
        map.set(child.properties.dataLn, child);
      }

      // Recurse into children
      traverse(child);
    }
  }

  traverse(node);
  return map;
}

/**
 * Checks if a line element contains only a comment with the given text.
 * A line is considered "comment-only" if it contains only whitespace, a .pl-c element,
 * and optionally .pl-pse elements (JSX comment braces like `{` and `}`).
 *
 * @param lineElement - The line element to check
 * @param commentText - The text the comment should contain (e.g., "@highlight-start")
 * @returns True if the line contains only a comment with the specified text
 */
function isCommentOnlyLine(lineElement: Element, commentText: string): boolean {
  if (!lineElement.children) {
    return false;
  }

  // Check if the line contains a .pl-c element with the expected text
  let hasMatchingComment = false;
  let hasNonWhitespaceContent = false;

  for (const child of lineElement.children) {
    if (child.type === 'text') {
      // Check if this is non-whitespace text
      if (child.value.trim() !== '') {
        hasNonWhitespaceContent = true;
      }
    } else if (child.type === 'element') {
      const className = child.properties?.className;
      const classNames = Array.isArray(className) ? className : [className];

      if (classNames.includes('pl-c')) {
        // This is a comment element - check if it contains the expected text
        const text = getHastTextContent(child);
        if (text.includes(commentText)) {
          hasMatchingComment = true;
        } else {
          // Some other comment
          hasNonWhitespaceContent = true;
        }
      } else if (classNames.includes('pl-pse')) {
        // This is punctuation for special expressions (JSX braces for comments)
        // Check if it's just `{` or `}` which are used for JSX comment syntax
        const text = getHastTextContent(child);
        if (text !== '{' && text !== '}') {
          hasNonWhitespaceContent = true;
        }
        // Otherwise ignore - these are just JSX comment syntax
      } else {
        // Non-comment element - check if it has non-whitespace content
        const text = getHastTextContent(child);
        if (text.trim() !== '') {
          hasNonWhitespaceContent = true;
        }
      }
    }
  }

  return hasMatchingComment && !hasNonWhitespaceContent;
}

/**
 * Calculates which lines should be emphasized based on parsed directives.
 *
 * @param directives - Parsed emphasis directives
 * @param lineElements - Map of line numbers to their HAST elements
 * @returns Map of line numbers to their emphasis metadata
 */
function calculateEmphasizedLines(
  directives: EmphasisDirective[],
  lineElements: Map<number, Element>,
): Map<number, EmphasisMeta> {
  const emphasizedLines = new Map<number, EmphasisMeta>();

  // Sort directives by line number for proper pairing
  const sortedDirectives = [...directives].sort((a, b) => a.line - b.line);

  // Process single line and text directives
  for (const directive of sortedDirectives) {
    if (directive.type === 'single') {
      const strong = directive.description?.endsWith('!') ?? false;
      // Strip trailing ! from description since it's just a signal for strong emphasis
      const description = capitalize(
        strong ? directive.description?.slice(0, -1).trimEnd() : directive.description,
      );
      emphasizedLines.set(directive.line, {
        description,
        strong,
        position: 'single',
        lineHighlight: true,
        focus: directive.focus,
      });
    } else if (directive.type === 'text') {
      // Text highlight - emphasize specific text(s) within the line.
      // Merge with any existing entry (e.g. when @highlight and @highlight-text
      // map to the same line after comment removal).
      const existing = emphasizedLines.get(directive.line);
      // Concatenate highlight texts when multiple directives target the same line.
      const mergedTexts = existing?.highlightTexts
        ? [...existing.highlightTexts, ...(directive.highlightTexts ?? [])]
        : directive.highlightTexts;
      emphasizedLines.set(directive.line, {
        ...existing,
        position: existing?.position ?? 'single',
        highlightTexts: mergedTexts,
        focus: directive.focus || existing?.focus,
      });
    }
  }

  // Process multiline directives by pairing starts with ends
  const startStack: EmphasisDirective[] = [];

  for (const directive of sortedDirectives) {
    if (directive.type === 'start') {
      startStack.push(directive);
    } else if (directive.type === 'end' && startStack.length > 0) {
      const startDirective = startStack.pop()!;

      // Check if the start directive's line contains only a comment (displayComments mode).
      // If so, the content to highlight starts on the NEXT line.
      // If the comment was stripped, the line number already points to the first content line.
      const startLineElement = lineElements.get(startDirective.line);
      const isStartCommentOnly =
        startLineElement && isCommentOnlyLine(startLineElement, '@highlight-start');

      const startLine = isStartCommentOnly ? startDirective.line + 1 : startDirective.line;
      const endLine = directive.line - 1;

      // Skip if no lines to emphasize (e.g., adjacent comments with no content between)
      if (startLine > endLine) {
        continue;
      }

      // Check if this is a strong emphasis (description ends with !)
      const strong = startDirective.description?.endsWith('!') ?? false;
      // Strip trailing ! from description since it's just a signal for strong emphasis
      const description = capitalize(
        strong ? startDirective.description?.slice(0, -1).trimEnd() : startDirective.description,
      );

      // Add all lines between start and end
      for (let line = startLine; line <= endLine; line += 1) {
        const existing = emphasizedLines.get(line);

        // Determine position for this line in the current range
        let position: 'start' | 'end' | undefined;
        if (line === startLine && line !== endLine) {
          position = 'start';
        } else if (line === endLine && line !== startLine) {
          position = 'end';
        }

        // If this line is already emphasized (from an inner range), mark it as strong
        // since it's now nested inside multiple emphasis ranges, and preserve inner positions
        const meta: EmphasisMeta = existing
          ? {
              // Nested ranges are strong unless the inner is a text highlight
              strong: existing.highlightTexts ? strong : true,
              description: existing.description ?? (line === startLine ? description : undefined),
              // Inner range position takes precedence, but 'single' from a standalone
              // @highlight-text should be replaced by the multiline range's position
              position:
                existing.position && existing.position !== 'single' ? existing.position : position,
              highlightTexts: existing.highlightTexts, // Preserve text highlights from @highlight-text
              lineHighlight: true, // Inside a multiline region = always line highlight
              focus: existing.focus || startDirective.focus,
            }
          : {
              strong,
              description: line === startLine ? description : undefined,
              position,
              lineHighlight: true,
              focus: startDirective.focus,
            };

        emphasizedLines.set(line, meta);
      }
    }
  }

  return emphasizedLines;
}

/**
 * Like {@link getHastTextContent} but replaces any text inside a
 * `data-hl` element with sentinel null characters so that those
 * regions are invisible to the text search in `wrapTextInHighlightSpan`.
 * This prevents nesting highlights when successive tokens overlap.
 */
function getSearchableText(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element') {
    if (node.properties?.dataHl !== undefined) {
      return '\0'.repeat(getHastTextContent(node).length);
    }
    if (node.children) {
      return node.children.map(getSearchableText).join('');
    }
  }
  return '';
}

/**
 * Injects a `data-hl` highlight span for a character range inside an
 * element's children, without splitting the element itself.
 * Used when a semantic element partially overlaps a match — the element
 * stays intact and the highlight is placed inside it.
 *
 * Uses a plan-based approach (like {@link wrapTextInHighlightSpan}) to
 * detect when the range produces multiple highlight fragments.  When the
 * caller already provides a `part` value, every fragment inherits it.
 * Otherwise, if multiple fragments are detected, `data-hl-part` values
 * (`"start"`, `"middle"`, `"end"`) are computed locally.
 *
 * @param children - The children of the element to modify
 * @param from - Start offset within the element's text content
 * @param to - End offset within the element's text content
 * @param part - Optional `data-hl-part` value inherited from the parent
 */
function injectHighlightInChildren(
  children: ElementContent[],
  from: number,
  to: number,
  part: string | undefined,
  strict: boolean,
  textToHighlight: string,
): ElementContent[] {
  type InjectPlanItem =
    | { kind: 'group'; nodes: ElementContent[] }
    | { kind: 'inject'; element: Element; from: number; to: number };

  const before: ElementContent[] = [];
  const after: ElementContent[] = [];
  const plan: InjectPlanItem[] = [];
  let currentGroup: ElementContent[] = [];
  let offset = 0;
  let pastRange = false;

  // Precompute text lengths to avoid repeated recursive walks per child.
  const childLengths = children.map((child) => getHastTextContent(child).length);

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      plan.push({ kind: 'group', nodes: currentGroup });
      currentGroup = [];
    }
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const len = childLengths[i];
    const childStart = offset;
    const childEnd = offset + len;
    offset = childEnd;

    if (pastRange) {
      after.push(child);
      continue;
    }

    if (childEnd <= from) {
      before.push(child);
      continue;
    }

    if (childStart >= to) {
      flushGroup();
      after.push(child);
      pastRange = true;
      continue;
    }

    if (childStart >= from && childEnd <= to) {
      currentGroup.push(child);
      continue;
    }

    // Straddling
    const overlapFrom = Math.max(from, childStart) - childStart;
    const overlapTo = Math.min(to, childEnd) - childStart;

    if (child.type === 'text') {
      const beforeText = child.value.slice(0, overlapFrom);
      const matchedText = child.value.slice(overlapFrom, overlapTo);
      const afterText = child.value.slice(overlapTo);

      if (beforeText) {
        flushGroup();
        before.push({ type: 'text', value: beforeText });
      }
      if (matchedText) {
        currentGroup.push({ type: 'text', value: matchedText });
      }
      if (afterText) {
        flushGroup();
        after.push({ type: 'text', value: afterText });
        pastRange = true;
      }
    } else if (child.type === 'element' && child.children) {
      // Nested element straddling — this is fragmentation across an element boundary
      if (strict) {
        throw new Error(
          `Base UI: @highlight-text "${textToHighlight}" straddles an element boundary. ` +
            'In strict mode, highlighted text must not be fragmented across elements. ' +
            'Adjust the highlighted text so it aligns with syntax token boundaries.',
        );
      }
      flushGroup();
      plan.push({
        kind: 'inject',
        element: child as Element,
        from: overlapFrom,
        to: overlapTo,
      });
      if (childEnd > to) {
        pastRange = true;
      }
    } else {
      currentGroup.push(child);
    }
  }

  flushGroup();

  // When the caller already supplied a part, every fragment inherits it.
  // Otherwise, when multiple fragments exist, compute parts locally.
  const needsParts = part === undefined && plan.length > 1;

  const highlighted: ElementContent[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    let effectivePart = part;
    if (needsParts) {
      if (i === 0) {
        effectivePart = 'start';
      } else if (i === plan.length - 1) {
        effectivePart = 'end';
      } else {
        effectivePart = 'middle';
      }
    }

    if (item.kind === 'group') {
      const props: Record<string, string> = { dataHl: '' };
      if (effectivePart !== undefined) {
        props.dataHlPart = effectivePart;
      }
      highlighted.push({
        type: 'element',
        tagName: 'span',
        properties: props,
        children: item.nodes,
      });
    } else {
      highlighted.push({
        ...item.element,
        children: injectHighlightInChildren(
          item.element.children,
          item.from,
          item.to,
          effectivePart,
          strict,
          textToHighlight,
        ),
      });
    }
  }

  return [...before, ...highlighted, ...after];
}

/**
 * Wraps all occurrences of a specific text within a line's children in
 * highlight spans with `data-hl`.
 *
 * Semantic element nodes (syntax-highlighting spans) are never split or
 * cloned. When a match partially overlaps an element, the highlight span
 * is injected *inside* the element via {@link injectHighlightInChildren}.
 * When a match covers entire elements, a single wrapper `data-hl` span
 * groups them all.
 *
 * If a match is fragmented (spans a partial element boundary), each
 * fragment gets a `data-hl-part` attribute (`"start"`, `"middle"`, or
 * `"end"`) so the segments can be styled together (e.g. border-radius).
 *
 * Already-highlighted nodes (`dataHl`) are excluded from matching so that
 * successive calls for different tokens don't nest or double-highlight.
 */
function wrapTextInHighlightSpan(
  children: ElementContent[],
  textToHighlight: string,
  strict: boolean,
): ElementContent[] {
  // Build searchable text, masking already-highlighted regions with sentinels.
  const segments = children.map(getSearchableText);
  const fullText = segments.join('');
  const matchIndex = fullText.indexOf(textToHighlight);

  if (matchIndex === -1) {
    return children;
  }

  const matchEnd = matchIndex + textToHighlight.length;

  // Classify each child relative to [matchIndex, matchEnd).
  // "group" items are fully-contained nodes wrapped in a single data-hl span.
  // "inject" items are elements that straddle a boundary — the highlight goes
  // inside them, preserving the semantic element.
  type PlanItem =
    | { kind: 'group'; nodes: ElementContent[] }
    | { kind: 'inject'; element: Element; from: number; to: number };

  const before: ElementContent[] = [];
  const after: ElementContent[] = [];
  const plan: PlanItem[] = [];
  let currentGroup: ElementContent[] = [];
  let offset = 0;
  let pastMatch = false;

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      plan.push({ kind: 'group', nodes: currentGroup });
      currentGroup = [];
    }
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const len = segments[i].length;
    const childStart = offset;
    const childEnd = offset + len;
    offset = childEnd;

    if (pastMatch) {
      after.push(child);
      continue;
    }

    // Entirely before match
    if (childEnd <= matchIndex) {
      before.push(child);
      continue;
    }

    // Entirely after match
    if (childStart >= matchEnd) {
      flushGroup();
      after.push(child);
      pastMatch = true;
      continue;
    }

    // Entirely within match
    if (childStart >= matchIndex && childEnd <= matchEnd) {
      currentGroup.push(child);
      continue;
    }

    // Straddling a boundary
    const overlapFrom = Math.max(matchIndex, childStart) - childStart;
    const overlapTo = Math.min(matchEnd, childEnd) - childStart;

    if (child.type === 'text') {
      // Text nodes can be split freely — they carry no semantic class.
      const beforeText = child.value.slice(0, overlapFrom);
      const matchedText = child.value.slice(overlapFrom, overlapTo);
      const afterText = child.value.slice(overlapTo);

      if (beforeText) {
        flushGroup();
        before.push({ type: 'text', value: beforeText });
      }
      if (matchedText) {
        currentGroup.push({ type: 'text', value: matchedText });
      }
      if (afterText) {
        flushGroup();
        after.push({ type: 'text', value: afterText });
        pastMatch = true;
      }
    } else if (child.type === 'element' && child.children) {
      // Element nodes are never split — inject highlight inside them.
      flushGroup();
      plan.push({
        kind: 'inject',
        element: child as Element,
        from: overlapFrom,
        to: overlapTo,
      });
      if (childEnd > matchEnd) {
        pastMatch = true;
      }
    } else {
      currentGroup.push(child);
    }
  }

  flushGroup();

  // When multiple highlight pieces exist (due to element boundary straddling),
  // mark each with data-hl-part so they can be styled as a group.
  const needsParts = plan.length > 1;

  if (strict && needsParts) {
    throw new Error(
      `Base UI: @highlight-text "${textToHighlight}" straddles an element boundary. ` +
        'In strict mode, highlighted text must not be fragmented across elements. ' +
        'Adjust the highlighted text so it aligns with syntax token boundaries.',
    );
  }

  const highlighted: ElementContent[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    let part: string | undefined;
    if (needsParts) {
      if (i === 0) {
        part = 'start';
      } else if (i === plan.length - 1) {
        part = 'end';
      } else {
        part = 'middle';
      }
    }

    if (item.kind === 'group') {
      const props: Record<string, string> = { dataHl: '' };
      if (part !== undefined) {
        props.dataHlPart = part;
      }
      highlighted.push({
        type: 'element',
        tagName: 'span',
        properties: props,
        children: item.nodes,
      });
    } else {
      const injectedChildren = injectHighlightInChildren(
        item.element.children,
        item.from,
        item.to,
        part,
        strict,
        textToHighlight,
      );
      highlighted.push({
        ...item.element,
        // Re-scan: the injected element may contain additional occurrences of the
        // text beyond the just-highlighted region (e.g. repeated tokens in its tail).
        children: wrapTextInHighlightSpan(injectedChildren, textToHighlight, strict),
      });
    }
  }

  return [
    ...before,
    ...highlighted,
    // Recursively process the remainder for additional occurrences
    ...wrapTextInHighlightSpan(after, textToHighlight, strict),
  ];
}

/**
 * Single-pass traversal that applies emphasis attributes to line elements
 * AND collects leading whitespace for indent calculation on highlighted lines.
 *
 * This merges what would otherwise be two separate traversals into one.
 *
 * @param node - The node to process
 * @param emphasizedLines - Map of line numbers to their emphasis metadata
 * @returns Array of line elements that are highlighted, grouped by region
 */
function applyEmphasisAndCollectHighlightedElements(
  node: HastRoot | Element,
  emphasizedLines: Map<number, EmphasisMeta>,
  options: EnhanceCodeEmphasisOptions,
): Element[] {
  const highlightedLineElements: Element[] = [];

  function traverse(n: HastRoot | Element): void {
    if (!('children' in n) || !n.children) {
      return;
    }

    for (let i = 0; i < n.children.length; i += 1) {
      const child = n.children[i];
      if (child.type !== 'element') {
        continue;
      }

      // Check if this is a line element
      if (
        child.tagName === 'span' &&
        child.properties?.className === 'line' &&
        typeof child.properties.dataLn === 'number'
      ) {
        const lineNumber = child.properties.dataLn;
        const meta = emphasizedLines.get(lineNumber);

        if (meta !== undefined) {
          if (meta.highlightTexts) {
            // For text highlight, wrap the specific text(s) in a span with data-hl
            let children = child.children;
            for (const text of meta.highlightTexts) {
              children = wrapTextInHighlightSpan(
                children,
                text,
                options.strictHighlightText === true,
              );
            }
            child.children = children;

            // Only mark the line with data-hl when the line also has a line-level
            // highlight (from @highlight, or from being inside a @highlight-start region).
            // Standalone @highlight-text lines should not get line-level highlights.
            if (meta.lineHighlight) {
              child.properties.dataHl = meta.strong ? 'strong' : '';

              if (meta.description) {
                child.properties.dataHlDescription = meta.description;
              }

              if (meta.position) {
                child.properties.dataHlPosition = meta.position;
              }
            }
          } else {
            // Use data-hl with optional "strong" value on the line
            child.properties.dataHl = meta.strong ? 'strong' : '';

            if (meta.description) {
              child.properties.dataHlDescription = meta.description;
            }

            if (meta.position) {
              child.properties.dataHlPosition = meta.position;
            }
          }

          // Collect this line element for indent calculation
          highlightedLineElements.push(child);
        }
      }

      // Recurse into children (for frames containing lines)
      traverse(child);
    }
  }

  traverse(node);
  return highlightedLineElements;
}

/**
 * Groups highlighted line elements by their highlight regions and calculates
 * the indent level for each region.
 *
 * @param highlightedElements - Line elements that are highlighted, in order
 * @param emphasizedLines - The emphasis metadata map
 * @returns Map from region index to indent level
 */
function calculateRegionIndentLevels(
  highlightedElements: Element[],
  emphasizedLines: Map<number, EmphasisMeta>,
): Map<number, number> {
  const regionIndentLevels = new Map<number, number>();

  if (highlightedElements.length === 0) {
    return regionIndentLevels;
  }

  // Group elements by consecutive regions
  const sortedLines = Array.from(emphasizedLines.keys()).sort((a, b) => a - b);
  let regionIndex = 0;
  let regionElements: Element[] = [];
  let prevLine = -1;

  // Build a quick lookup from lineNumber to element
  const elementByLine = new Map<number, Element>();
  for (const el of highlightedElements) {
    const ln = el.properties?.dataLn as number;
    elementByLine.set(ln, el);
  }

  for (const line of sortedLines) {
    const el = elementByLine.get(line);
    if (!el) {
      continue;
    }

    if (prevLine >= 0 && line !== prevLine + 1) {
      // Gap: close current region
      regionIndentLevels.set(regionIndex, calculateFrameIndent(regionElements));
      regionIndex += 1;
      regionElements = [];
    }
    regionElements.push(el);
    prevLine = line;
  }

  // Close the last region
  if (regionElements.length > 0) {
    regionIndentLevels.set(regionIndex, calculateFrameIndent(regionElements));
  }

  return regionIndentLevels;
}

/**
 * Creates a source enhancer that adds emphasis to code lines based on `@highlight` comments
 * and restructures frames around highlighted regions.
 *
 * Supports five patterns:
 *
 * 1. **Single line emphasis** - emphasizes the line containing the comment:
 *    ```jsx
 *    <h1>Heading 1</h1> {/* @highlight *\/}
 *    ```
 *
 * 2. **Multiline emphasis** - emphasizes all lines between start and end:
 *    ```jsx
 *    // @highlight-start
 *    <div>
 *      <h1>Heading 1</h1>
 *    </div>
 *    // @highlight-end
 *    ```
 *
 * 3. **Multiline with description**:
 *    ```jsx
 *    // @highlight-start "we add a heading"
 *    <div>
 *      <h1>Heading 1</h1>
 *    </div>
 *    // @highlight-end
 *    ```
 *
 * 4. **Text highlight** - highlights specific text within a line:
 *    ```jsx
 *    <h1>Heading 1</h1> {/* @highlight-text "Heading 1" *\/}
 *    ```
 *
 * 5. **Focus override** - mark a region for padding focus:
 *    ```jsx
 *    <h1>Heading 1</h1> {/* @highlight @focus *\/}
 *    ```
 *
 * Emphasized lines receive a `data-hl` attribute on their `<span class="line">` element.
 * When highlights exist, frames are restructured with `data-frame-type` attributes
 * (`highlighted`, `padding-top`, `padding-bottom`, or omitted for normal).
 * Highlighted frames also receive `data-frame-indent` with the shared indent level.
 *
 * @param options - Optional configuration for padding frames
 * @returns A `SourceEnhancer` function
 *
 * @example
 * ```ts
 * import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
 *
 * const enhancers = [createEnhanceCodeEmphasis({ paddingFrameMaxSize: 5, focusFramesMaxSize: 8 })];
 * ```
 */
export function createEnhanceCodeEmphasis(
  options: EnhanceCodeEmphasisOptions = {},
): SourceEnhancer {
  return (root: HastRoot, comments: SourceComments | undefined): HastRoot => {
    if (!comments || Object.keys(comments).length === 0) {
      return root;
    }

    // Step 1: Parse directives from comments (no tree traversal)
    const directives = parseEmphasisDirectives(comments);

    if (directives.length === 0) {
      return root;
    }

    // Step 2 (Traversal 1): Build line element map
    const lineElements = buildLineElementMap(root);

    // Step 3: Calculate which lines are emphasized (no tree traversal)
    const emphasizedLines = calculateEmphasizedLines(directives, lineElements);

    if (emphasizedLines.size === 0) {
      return root;
    }

    // Step 4 (Traversal 2): Apply emphasis attributes AND collect highlighted elements
    const highlightedElements = applyEmphasisAndCollectHighlightedElements(
      root,
      emphasizedLines,
      options,
    );

    // Step 5: Calculate indent levels per region (uses collected elements, no tree traversal)
    const regionIndentLevels = calculateRegionIndentLevels(highlightedElements, emphasizedLines);

    // Step 6: Calculate frame ranges (pure math, no tree traversal)
    const totalLines = (root.data as { totalLines?: number })?.totalLines ?? lineElements.size;
    const frameRanges = calculateFrameRanges(emphasizedLines, totalLines, options);

    // Step 7: Restructure frames (flat iteration, not deep recursive traversal)
    restructureFrames(root, frameRanges, regionIndentLevels);

    return root;
  };
}

/**
 * Default source enhancer that adds emphasis to code lines based on `@highlight` comments.
 * Uses no padding frames by default. Use `createEnhanceCodeEmphasis` for configurable padding.
 *
 * @example
 * ```ts
 * import { enhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
 *
 * const enhancers = [enhanceCodeEmphasis];
 * ```
 */
export const enhanceCodeEmphasis: SourceEnhancer = createEnhanceCodeEmphasis();
