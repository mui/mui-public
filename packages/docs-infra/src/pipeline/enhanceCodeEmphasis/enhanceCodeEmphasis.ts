import type { Element, ElementContent } from 'hast';
import type { HastRoot, SourceComments, SourceEnhancer } from '../../CodeHighlighter/types';
import { getHastTextContent } from '../loadServerTypes/hastTypeUtils';
import type {
  EmphasisMeta,
  EnhanceCodeEmphasisOptions,
  FrameRange,
} from '../parseSource/calculateFrameRanges';
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
 * The prefix used to identify focus-only comments in source code.
 * Comments starting with this prefix will mark the region as focused without highlighting.
 */
export const FOCUS_COMMENT_PREFIX = '@focus';

/**
 * Modifier token used inside `@highlight` / `@focus` comments
 * to override padding for that directive.
 * Example: @highlight @padding 2.
 */
export const PADDING_COMMENT_PREFIX = '@padding';

/**
 * Modifier token used inside `@highlight` / `@focus` comments
 * to override focus max size for that directive.
 * Example: @highlight @min 6.
 */
export const MIN_COMMENT_PREFIX = '@min';

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
  /** Whether the line should be visually highlighted (false for focus-only directives) */
  lineHighlight: boolean;
  /** Optional padding override for this region (applies to @highlight, @highlight-start, @focus, @focus-start) */
  paddingFrameMaxSize?: number;
  /** Optional focus max size override for this region (applies to @highlight, @highlight-start, @focus, @focus-start) */
  focusFramesMaxSize?: number;
}

/**
 * Replaces quoted content with underscores of the same length so that
 * regex matching only finds tokens in unquoted territory.
 * Supports double ("...") and single ('...') quotes.
 */
function maskQuotedContent(content: string): string {
  let result = '';
  let quoteChar: string | undefined;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (quoteChar) {
      result += '_';
      if (char === quoteChar) {
        quoteChar = undefined;
      }
    } else if (char === '"' || char === "'") {
      quoteChar = char;
      result += '_';
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Returns `true` when `ch` is an ASCII whitespace character.
 */
function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/**
 * Finds the first occurrence of `token` in `masked` that sits at a word
 * boundary (preceded by start-of-string or whitespace, followed by
 * end-of-string or whitespace).  Returns the index or -1.
 */
function findToken(masked: string, token: string, startFrom = 0): number {
  let idx = masked.indexOf(token, startFrom);
  while (idx !== -1) {
    const before = idx === 0 || isWhitespace(masked[idx - 1]);
    const after = idx + token.length >= masked.length || isWhitespace(masked[idx + token.length]);
    if (before && after) {
      return idx;
    }
    idx = masked.indexOf(token, idx + 1);
  }
  return -1;
}

/**
 * Reads consecutive ASCII digits starting at `pos`.
 * Returns the substring of digits (may be empty).
 */
function readDigits(str: string, pos: number): string {
  let end = pos;
  while (end < str.length && str[end] >= '0' && str[end] <= '9') {
    end += 1;
  }
  return str.slice(pos, end);
}

/**
 * Collapses runs of whitespace into a single space and trims.
 */
function collapseWhitespace(str: string): string {
  let result = '';
  let prevSpace = false;
  for (let i = 0; i < str.length; i += 1) {
    if (isWhitespace(str[i])) {
      prevSpace = true;
    } else {
      if (prevSpace && result.length > 0) {
        result += ' ';
      }
      prevSpace = false;
      result += str[i];
    }
  }
  return result;
}

/**
 * Extracts a number from content (e.g., "3" from "@padding 3 @focus").
 * Returns the parsed number or undefined if not found or invalid.
 * Only matches unquoted tokens — "@padding 2" inside quotes is ignored.
 */
function extractPaddingValue(content: string): number | undefined {
  const masked = maskQuotedContent(content);
  const idx = findToken(masked, '@padding');
  if (idx === -1) {
    return undefined;
  }
  // Skip whitespace after "@padding"
  let pos = idx + '@padding'.length;
  while (pos < masked.length && isWhitespace(masked[pos])) {
    pos += 1;
  }
  const digits = readDigits(masked, pos);
  if (digits.length === 0) {
    return undefined;
  }
  // Must be followed by whitespace or end-of-string
  const afterDigits = pos + digits.length;
  if (afterDigits < masked.length && !isWhitespace(masked[afterDigits])) {
    return undefined;
  }
  const value = parseInt(digits, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Removes the `@padding N` directive from content (if present).
 * Only removes unquoted tokens — "@padding 2" inside quotes is preserved.
 */
function removePaddingDirective(content: string): string {
  const masked = maskQuotedContent(content);
  const idx = findToken(masked, '@padding');
  if (idx === -1) {
    return content;
  }
  // Find the full span: leading whitespace + "@padding" + optional whitespace + digits + trailing whitespace
  let start = idx;
  while (start > 0 && isWhitespace(content[start - 1])) {
    start -= 1;
  }
  let end = idx + '@padding'.length;
  while (end < content.length && isWhitespace(content[end])) {
    end += 1;
  }
  // Skip digits
  while (end < content.length && content[end] >= '0' && content[end] <= '9') {
    end += 1;
  }
  // Skip trailing whitespace
  while (end < content.length && isWhitespace(content[end])) {
    end += 1;
  }
  return collapseWhitespace(`${content.slice(0, start)} ${content.slice(end)}`);
}

/**
 * Extracts a number from content (e.g., "6" from "@min 6 @focus").
 * Returns the parsed number or undefined if not found or invalid.
 * Only matches unquoted tokens — "@min 6" inside quotes is ignored.
 */
function extractMinValue(content: string): number | undefined {
  const masked = maskQuotedContent(content);
  const idx = findToken(masked, '@min');
  if (idx === -1) {
    return undefined;
  }
  // Skip whitespace after "@min"
  let pos = idx + '@min'.length;
  while (pos < masked.length && isWhitespace(masked[pos])) {
    pos += 1;
  }
  const digits = readDigits(masked, pos);
  if (digits.length === 0) {
    return undefined;
  }
  // Must be followed by whitespace or end-of-string
  const afterDigits = pos + digits.length;
  if (afterDigits < masked.length && !isWhitespace(masked[afterDigits])) {
    return undefined;
  }
  const value = parseInt(digits, 10);
  return Number.isNaN(value) || value < 1 ? undefined : value;
}

/**
 * Removes the `@min` directive (and its optional value) from content.
 * Only removes unquoted tokens — "@min 6" inside quotes is preserved.
 */
function removeMinDirective(content: string): string {
  const masked = maskQuotedContent(content);
  const idx = findToken(masked, '@min');
  if (idx === -1) {
    return content;
  }
  // Find the full span: leading whitespace + "@min" + optional (whitespace + non-whitespace value) + trailing whitespace
  let start = idx;
  while (start > 0 && isWhitespace(content[start - 1])) {
    start -= 1;
  }
  let end = idx + '@min'.length;
  // Skip whitespace after @min
  let ws = end;
  while (ws < content.length && isWhitespace(content[ws])) {
    ws += 1;
  }
  // If there's a non-whitespace, non-quote value after @min, skip it
  if (
    ws < content.length &&
    content[ws] !== '"' &&
    content[ws] !== "'" &&
    !isWhitespace(content[ws])
  ) {
    end = ws;
    while (end < content.length && !isWhitespace(content[end])) {
      end += 1;
    }
  }
  // Skip trailing whitespace
  while (end < content.length && isWhitespace(content[end])) {
    end += 1;
  }
  return collapseWhitespace(`${content.slice(0, start)} ${content.slice(end)}`);
}

/**
 * Extracts a quoted string from content.
 * Supports both double quotes ("...") and single quotes ('...').
 * If the entire content is a single quoted string, returns its inner text.
 * Otherwise returns the first quoted substring found.
 */
function extractQuotedString(content: string): string | undefined {
  const trimmed = content.trim();
  // Check if the entire content is a single quoted string
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed[trimmed.length - 1] === first) {
      return trimmed.slice(1, -1);
    }
  }
  // Find first quoted substring anywhere
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '"' || char === "'") {
      const close = content.indexOf(char, i + 1);
      if (close !== -1 && close > i + 1) {
        return content.slice(i + 1, close);
      }
    }
  }
  return undefined;
}

/**
 * Extracts all quoted strings from content.
 * Supports both double quotes ("...") and single quotes ('...').
 */
function extractAllQuotedStrings(content: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    if (char === '"' || char === "'") {
      const close = content.indexOf(char, i + 1);
      if (close !== -1 && close > i + 1) {
        results.push(content.slice(i + 1, close));
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return results;
}

/**
 * Extracts and removes the `@focus` keyword from content.
 */
function extractFocus(content: string): { focus: boolean; remaining: string } {
  const masked = maskQuotedContent(content);
  const idx = findToken(masked, '@focus');
  if (idx === -1) {
    return { focus: false, remaining: content };
  }
  const remaining = (content.slice(0, idx) + content.slice(idx + '@focus'.length)).trim();
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
 * - Focus only (single line): `@focus`
 * - Focus only (multiline): `@focus-start` / `@focus-end`
 *
 * @param comments - Source comments keyed by line number
 * @returns Array of parsed emphasis directives
 */
function parseEmphasisDirectives(comments: SourceComments): EmphasisDirective[] {
  const directives: EmphasisDirective[] = [];

  for (const [lineStr, commentArray] of Object.entries(comments)) {
    const line = parseInt(lineStr, 10);

    for (const comment of commentArray) {
      // Check if this is a @highlight comment
      if (comment.startsWith(EMPHASIS_COMMENT_PREFIX)) {
        const content = comment.slice(EMPHASIS_COMMENT_PREFIX.length);
        parseHighlightDirective(directives, line, content);
        continue;
      }

      // Check if this is a @focus comment (focus-only, no highlight)
      if (comment.startsWith(FOCUS_COMMENT_PREFIX)) {
        const content = comment.slice(FOCUS_COMMENT_PREFIX.length);
        parseFocusDirective(directives, line, content);
      }
    }
  }

  return directives;
}

/**
 * Parses a `@highlight` comment into one or more directives.
 */
function parseHighlightDirective(
  directives: EmphasisDirective[],
  line: number,
  content: string,
): void {
  // Extract @padding if present
  const paddingFrameMaxSize = extractPaddingValue(content);
  const focusFramesMaxSize = extractMinValue(content);
  const contentWithoutModifiers = removeMinDirective(removePaddingDirective(content));

  if (contentWithoutModifiers.startsWith('-end')) {
    directives.push({
      line,
      type: 'end',
      lineHighlight: true,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  } else if (contentWithoutModifiers.startsWith('-start')) {
    const afterStart = contentWithoutModifiers.slice('-start'.length).trim();
    const { focus, remaining: remainingStart } = extractFocus(afterStart);
    const description = extractQuotedString(remainingStart);
    directives.push({
      line,
      type: 'start',
      description,
      focus,
      lineHighlight: true,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  } else if (contentWithoutModifiers.startsWith('-text')) {
    const afterText = contentWithoutModifiers.slice('-text'.length).trim();
    const { focus, remaining: remainingText } = extractFocus(afterText);
    const highlightTexts = extractAllQuotedStrings(remainingText);
    if (highlightTexts.length > 0) {
      // Text-only markers should not influence region padding, so
      // @padding/@min modifiers are intentionally omitted here.
      // lineHighlight is false because @highlight-text only highlights
      // inline text, it does NOT highlight the line itself.
      directives.push({
        line,
        type: 'text',
        highlightTexts,
        focus,
        lineHighlight: false,
        paddingFrameMaxSize: undefined,
        focusFramesMaxSize: undefined,
      });
    }
  } else {
    const afterHighlight = contentWithoutModifiers.trim();
    const { focus, remaining: remainingSingle } = extractFocus(afterHighlight);
    const description = extractQuotedString(remainingSingle) || undefined;
    directives.push({
      line,
      type: 'single',
      description,
      focus,
      lineHighlight: true,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  }
}

/**
 * Parses a `@focus` comment into a focus-only directive (no line highlight).
 */
function parseFocusDirective(directives: EmphasisDirective[], line: number, content: string): void {
  // Extract @padding if present
  const paddingFrameMaxSize = extractPaddingValue(content);
  const focusFramesMaxSize = extractMinValue(content);
  const contentWithoutModifiers = removeMinDirective(removePaddingDirective(content));

  if (contentWithoutModifiers.startsWith('-end')) {
    directives.push({
      line,
      type: 'end',
      lineHighlight: false,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  } else if (contentWithoutModifiers.startsWith('-start')) {
    const afterStart = contentWithoutModifiers.slice('-start'.length).trim();
    const description = extractQuotedString(afterStart);
    directives.push({
      line,
      type: 'start',
      description,
      focus: true,
      lineHighlight: false,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  } else {
    // Single line: @focus or @focus "description"
    const afterFocus = contentWithoutModifiers.trim();
    const description = extractQuotedString(afterFocus) || undefined;
    directives.push({
      line,
      type: 'single',
      description,
      focus: true,
      lineHighlight: false,
      paddingFrameMaxSize,
      focusFramesMaxSize,
    });
  }
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
        lineHighlight: directive.lineHighlight,
        focus: directive.focus,
        paddingFrameMaxSize: directive.paddingFrameMaxSize,
        focusFramesMaxSize: directive.focusFramesMaxSize,
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
        lineHighlight: existing?.lineHighlight ?? directive.lineHighlight,
        highlightTexts: mergedTexts,
        focus: directive.focus || existing?.focus,
        paddingFrameMaxSize: directive.paddingFrameMaxSize ?? existing?.paddingFrameMaxSize,
        focusFramesMaxSize: directive.focusFramesMaxSize ?? existing?.focusFramesMaxSize,
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
        startLineElement &&
        (isCommentOnlyLine(startLineElement, '@highlight-start') ||
          isCommentOnlyLine(startLineElement, '@focus-start'));

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
        // only when both ranges have lineHighlight (true nesting of highlights).
        // A focus range overlapping with a highlight is not nesting — it just
        // merges focus into the existing entry.
        const meta: EmphasisMeta = existing
          ? {
              // Nested highlight ranges are strong; focus+highlight overlap is not
              strong:
                (existing.lineHighlight &&
                  startDirective.lineHighlight &&
                  !existing.highlightTexts) ||
                existing.strong ||
                strong,
              description: existing.description ?? (line === startLine ? description : undefined),
              // Inner range position takes precedence, but 'single' from a standalone
              // @highlight-text should be replaced by the multiline range's position.
              // Keep 'single' from regular @highlight (no highlightTexts).
              position:
                existing.position && !(existing.position === 'single' && existing.highlightTexts)
                  ? existing.position
                  : position,
              highlightTexts: existing.highlightTexts, // Preserve text highlights from @highlight-text
              lineHighlight: existing.lineHighlight || startDirective.lineHighlight,
              focus: existing.focus || startDirective.focus,
              // When the outer range is focus and the inner is not, the focus
              // range's overrides win (focus tier > non-focus).  When both
              // are the same tier, the inner (existing) wins since it was
              // placed by a more specific directive.
              paddingFrameMaxSize:
                startDirective.focus && !existing.focus
                  ? (startDirective.paddingFrameMaxSize ?? existing.paddingFrameMaxSize)
                  : (existing.paddingFrameMaxSize ?? startDirective.paddingFrameMaxSize),
              focusFramesMaxSize:
                startDirective.focus && !existing.focus
                  ? (startDirective.focusFramesMaxSize ?? existing.focusFramesMaxSize)
                  : (existing.focusFramesMaxSize ?? startDirective.focusFramesMaxSize),
              // Propagated when existing had no overrides of its own (all come
              // from the range), or when existing was itself propagated.
              propagatedOverride:
                existing.paddingFrameMaxSize !== undefined ||
                existing.focusFramesMaxSize !== undefined
                  ? existing.propagatedOverride
                  : true,
              // Track how many containing highlight ranges wrap this line
              // so that inline <mark> elements can receive the right data-hl tier.
              containingRangeDepth: startDirective.lineHighlight
                ? (existing.containingRangeDepth ?? 0) + 1
                : existing.containingRangeDepth,
            }
          : {
              strong,
              description: line === startLine ? description : undefined,
              position,
              lineHighlight: startDirective.lineHighlight,
              focus: startDirective.focus,
              paddingFrameMaxSize: startDirective.paddingFrameMaxSize,
              focusFramesMaxSize: startDirective.focusFramesMaxSize,
              propagatedOverride: true,
            };

        emphasizedLines.set(line, meta);
      }
    }
  }

  return emphasizedLines;
}

/**
 * Converts a group of nodes into a `<mark>` element.
 *
 * When the group contains exactly one `<span>` child, we replace that
 * element in-place — changing its `tagName` to `mark` and merging the
 * highlight properties — instead of wrapping it in an extra `<mark>`.
 * This keeps the output flat (e.g. `<mark class="pl-e">config</mark>`
 * instead of `<mark><span class="pl-e">config</span></mark>`).
 */
function groupToMark(nodes: ElementContent[], props: Record<string, string>): ElementContent {
  if (nodes.length === 1 && nodes[0].type === 'element' && nodes[0].tagName === 'span') {
    const child = nodes[0];
    return {
      ...child,
      tagName: 'mark',
      properties: { ...child.properties, ...props },
    };
  }
  return {
    type: 'element',
    tagName: 'mark',
    properties: props,
    children: nodes,
  };
}

/**
 * Like {@link getHastTextContent} but replaces any text inside a
 * `<mark>` element with sentinel null characters so that those
 * regions are invisible to the text search in `wrapTextInHighlightSpan`.
 * This prevents nesting highlights when successive tokens overlap.
 */
function getSearchableText(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element') {
    if (node.tagName === 'mark') {
      return '\0'.repeat(getHastTextContent(node).length);
    }
    if (node.children) {
      return node.children.map(getSearchableText).join('');
    }
  }
  return '';
}

/**
 * Recursively walks children and adds `data-hl` to any `<mark>` elements
 * so they inherit the highlight level of their parent line.
 */
function propagateHlToMarks(children: ElementContent[], hlValue: string): void {
  for (const child of children) {
    if (child.type === 'element') {
      if (child.tagName === 'mark') {
        child.properties = child.properties || {};
        child.properties.dataHl = hlValue;
      }
      if (child.children) {
        propagateHlToMarks(child.children, hlValue);
      }
    }
  }
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
      const props: Record<string, string> = {};
      if (effectivePart !== undefined) {
        props.dataHlPart = effectivePart;
      }
      highlighted.push(groupToMark(item.nodes, props));
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
 * `<mark>` elements.
 *
 * Semantic element nodes (syntax-highlighting spans) are never split or
 * cloned. When a match partially overlaps an element, the highlight is
 * injected *inside* the element via {@link injectHighlightInChildren}.
 * When a match covers entire elements, a single wrapper `<mark>`
 * groups them all.
 *
 * If a match is fragmented (spans a partial element boundary), each
 * fragment gets a `data-hl-part` attribute (`"start"`, `"middle"`, or
 * `"end"`) so the segments can be styled together (e.g. border-radius).
 *
 * Already-highlighted nodes (`<mark>`) are excluded from matching so that
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
      const props: Record<string, string> = {};
      if (part !== undefined) {
        props.dataHlPart = part;
      }
      highlighted.push(groupToMark(item.nodes, props));
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
          // Determine whether line-level data-hl should be applied.
          // Line-level highlighting is only needed when highlight lines appear
          // inside a focus frame (highlight + focus), or when highlights are nested
          // (strong). Simple standalone highlights don't need line-level marks
          // because the frame itself handles the visual emphasis.
          const shouldApplyLineHl =
            meta.lineHighlight && (meta.focus === true || meta.strong === true);

          if (meta.highlightTexts) {
            // For text highlight, wrap the specific text(s) in a <mark> element
            let children = child.children;
            for (const text of meta.highlightTexts) {
              children = wrapTextInHighlightSpan(
                children,
                text,
                options.strictHighlightText === true,
              );
            }
            child.children = children;

            // Propagate data-hl to inline <mark> elements based on how many
            // containing highlight ranges wrap this line. This gives marks
            // 3 visual tiers: bare (standalone), data-hl="" (inside 1 range),
            // and data-hl="strong" (inside 2+ nested ranges).
            if (meta.containingRangeDepth && meta.containingRangeDepth > 0) {
              const markHlValue = meta.containingRangeDepth >= 2 ? 'strong' : '';
              propagateHlToMarks(child.children, markHlValue);
            }

            // Only mark the line with data-hl when the highlight is nested
            // (inside a focus frame or strong from nesting).
            // Standalone @highlight-text lines should not get line-level marks
            // because the frame itself handles the visual emphasis.
            if (shouldApplyLineHl) {
              const hlValue = meta.strong ? 'strong' : '';
              child.properties.dataHl = hlValue;

              if (meta.description) {
                child.properties.dataHlDescription = meta.description;
              }

              if (meta.position) {
                child.properties.dataHlPosition = meta.position;
              }
            }
          } else if (shouldApplyLineHl) {
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
 * Post-restructure pass that reconciles line-level `data-hl` attributes with
 * frame-level types.
 *
 * When a frame's type is `highlighted` or `highlighted-unfocused`, the frame
 * itself already communicates the highlight — so line-level `data-hl` (empty
 * value) is redundant and gets stripped. `data-hl="strong"` is preserved
 * because it communicates deeper nesting that the frame type alone can't convey.
 *
 * Descriptions from stripped lines are promoted to the frame element as
 * `data-frame-description`. For lines that never received `data-hl` in the first
 * place (standalone highlights without focus), descriptions are also promoted.
 */
function reconcileLineAndFrameEmphasis(
  root: HastRoot,
  emphasizedLines: Map<number, EmphasisMeta>,
): void {
  for (const frame of root.children) {
    if (frame.type !== 'element') {
      continue;
    }

    const frameType = frame.properties?.dataFrameType as string | undefined;
    const isHighlightedFrame = frameType === 'highlighted' || frameType === 'highlighted-unfocused';

    for (const child of frame.children) {
      if (
        child.type !== 'element' ||
        child.tagName !== 'span' ||
        child.properties?.className !== 'line' ||
        typeof child.properties.dataLn !== 'number'
      ) {
        continue;
      }

      const meta = emphasizedLines.get(child.properties.dataLn);
      if (!meta) {
        continue;
      }

      // In highlighted/highlighted-unfocused frames, strip redundant line-level
      // data-hl (empty value only). The frame already communicates the highlight.
      // Keep data-hl="strong" — it conveys deeper nesting the frame can't express.
      if (
        isHighlightedFrame &&
        'dataHl' in (child.properties ?? {}) &&
        child.properties.dataHl !== 'strong'
      ) {
        delete child.properties.dataHl;

        // Move description and position to the frame since line-level attrs are gone
        if (child.properties.dataHlDescription) {
          frame.properties ??= {};
          frame.properties.dataFrameDescription = child.properties.dataHlDescription;
          delete child.properties.dataHlDescription;
        }
        if (child.properties.dataHlPosition) {
          delete child.properties.dataHlPosition;
        }
        continue;
      }

      // For non-highlighted frames: promote descriptions to the frame when the
      // line doesn't have data-hl (standalone highlights without focus).
      if (meta.description && !('dataHl' in (child.properties ?? {}))) {
        frame.properties ??= {};
        frame.properties.dataFrameDescription = meta.description;
      }
    }
  }
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
    // Helper: mark root as collapsible when hidden and visible emphasis frames coexist
    function markCollapsible(frameRanges: FrameRange[]) {
      let hasHidden = false;
      let hasVisible = false;
      for (const range of frameRanges) {
        if (
          range.type === 'normal' ||
          range.type === 'highlighted-unfocused' ||
          range.type === 'focus-unfocused'
        ) {
          hasHidden = true;
        } else if (
          range.type === 'highlighted' ||
          range.type === 'focus' ||
          range.type === 'padding-top' ||
          range.type === 'padding-bottom'
        ) {
          hasVisible = true;
        }
        if (hasHidden && hasVisible) {
          root.data = { ...root.data, collapsible: true };
          return;
        }
      }
    }

    // Step 1: Parse directives from comments (no tree traversal)
    const directives =
      comments && Object.keys(comments).length > 0 ? parseEmphasisDirectives(comments) : [];

    const effectiveOptions = options;
    const hasDirectives = directives.length > 0;

    // Step 2 (Traversal 1): Build line element map
    const lineElements = buildLineElementMap(root);
    const totalLines = (root.data as { totalLines?: number })?.totalLines ?? lineElements.size;

    // Read frameSize from HAST (set by starryNightGutter when it splits frames)
    // so emphasis reframing matches the original gutter split size
    const normalFrameMaxSize = root.data?.frameSize;

    if (!hasDirectives) {
      // Auto-focus path: no emphasis, just frame restructuring
      const frameRanges = calculateFrameRanges(
        new Map(),
        totalLines,
        effectiveOptions,
        normalFrameMaxSize,
      );
      restructureFrames(root, frameRanges, new Map());
      markCollapsible(frameRanges);
      return root;
    }

    // Step 3: Calculate which lines are emphasized (no tree traversal)
    const emphasizedLines = calculateEmphasizedLines(directives, lineElements);

    if (emphasizedLines.size === 0) {
      return root;
    }

    // Step 4 (Traversal 2): Apply emphasis attributes AND collect highlighted elements
    const highlightedElements = applyEmphasisAndCollectHighlightedElements(
      root,
      emphasizedLines,
      effectiveOptions,
    );

    // Step 5: Calculate indent levels per region (uses collected elements, no tree traversal)
    const regionIndentLevels = calculateRegionIndentLevels(highlightedElements, emphasizedLines);

    // Step 6: Calculate frame ranges (pure math, no tree traversal)
    // Filter out text-only lines that don't need their own frames.
    // They still receive inline <mark> wrapping from applyEmphasis (step 4).
    const frameEmphasizedLines = new Map<number, EmphasisMeta>();
    for (const [line, meta] of emphasizedLines) {
      if (meta.lineHighlight || meta.focus || !meta.highlightTexts) {
        frameEmphasizedLines.set(line, meta);
      }
    }
    const frameRanges = calculateFrameRanges(
      frameEmphasizedLines.size > 0 ? frameEmphasizedLines : new Map(),
      totalLines,
      effectiveOptions,
      normalFrameMaxSize,
    );

    // Step 7: Restructure frames (flat iteration, not deep recursive traversal)
    restructureFrames(root, frameRanges, regionIndentLevels);
    markCollapsible(frameRanges);

    // Step 8: Reconcile line-level data-hl with frame types and promote descriptions
    reconcileLineAndFrameEmphasis(root, emphasizedLines);

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
