import type { Element, ElementContent } from 'hast';
import type { HastRoot, SourceComments, SourceEnhancer } from '../../CodeHighlighter/types';

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
  /** For 'text' type: the text to highlight within the line */
  highlightText?: string;
}

/**
 * Metadata for an emphasized line.
 */
interface EmphasisMeta {
  /** Optional description for this emphasis */
  description?: string;
  /** Position: 'single' for single-line, 'start'/'end' for multiline range bounds, undefined for middle */
  position?: 'single' | 'start' | 'end';
  /** Whether this is a strong emphasis (description ended with !) */
  strong?: boolean;
  /** For text highlighting: the specific text to highlight within the line */
  highlightText?: string;
}

/**
 * Extracts a quoted string from content.
 * Supports both double quotes ("...") and single quotes ('...').
 *
 * @param content - The content to extract the quoted string from
 * @returns The extracted string (without quotes) or undefined if no quoted string found
 */
function extractQuotedString(content: string): string | undefined {
  // Match either double-quoted or single-quoted string
  const match = content.match(/^["'](.*)["']$/);
  if (match) {
    return match[1];
  }
  // Also try to find quoted string anywhere in the content
  const anyMatch = content.match(/["']([^"']+)["']/);
  return anyMatch?.[1];
}

/**
 * Parses emphasis comments and returns structured directives.
 *
 * Supported formats:
 * - Single line: `@highlight` or `@highlight "description"`
 * - Multiline start: `@highlight-start` or `@highlight-start "description"`
 * - Multiline end: `@highlight-end`
 * - Text highlight: `@highlight-text "text to highlight"`
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
        const description = extractQuotedString(afterStart);
        directives.push({
          line,
          type: 'start',
          description,
        });
      } else if (content.startsWith('-text')) {
        // Text highlight: @highlight-text "text to highlight"
        const afterText = content.slice('-text'.length).trim();
        const highlightText = extractQuotedString(afterText);
        if (highlightText) {
          directives.push({
            line,
            type: 'text',
            highlightText,
          });
        }
      } else {
        // Single line emphasis: @highlight or @highlight "description"
        const afterHighlight = content.trim();
        const description = extractQuotedString(afterHighlight) || undefined;
        directives.push({
          line,
          type: 'single',
          description,
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
 * Checks if a line element contains only a comment with the given text.
 * A line is considered "comment-only" if it contains only whitespace and a .pl-c element.
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
        const text = getElementText(child);
        if (text.includes(commentText)) {
          hasMatchingComment = true;
        } else {
          // Some other comment
          hasNonWhitespaceContent = true;
        }
      } else {
        // Non-comment element - check if it has non-whitespace content
        const text = getElementText(child);
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
      });
    } else if (directive.type === 'text') {
      // Text highlight - emphasize specific text within the line
      emphasizedLines.set(directive.line, {
        position: 'single',
        highlightText: directive.highlightText,
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
              strong: true, // Nested = always strong
              description: existing.description ?? (line === startLine ? description : undefined),
              position: existing.position ?? position, // Inner range position takes precedence
            }
          : {
              strong,
              description: line === startLine ? description : undefined,
              position,
            };

        emphasizedLines.set(line, meta);
      }
    }
  }

  return emphasizedLines;
}

/**
 * Recursively wraps occurrences of a specific text within an element's children
 * with a span that has `data-hl` attribute.
 *
 * @param children - The children array to process
 * @param textToHighlight - The text to find and wrap
 * @returns New children array with text wrapped in highlight spans
 */
function wrapTextInHighlightSpan(
  children: ElementContent[],
  textToHighlight: string,
): ElementContent[] {
  const result: ElementContent[] = [];

  for (const child of children) {
    if (child.type === 'text') {
      // Check if this text node contains the text to highlight
      const text = child.value;
      const index = text.indexOf(textToHighlight);

      if (index !== -1) {
        // Split the text and wrap the matched portion
        const before = text.slice(0, index);
        const after = text.slice(index + textToHighlight.length);

        if (before) {
          result.push({ type: 'text', value: before });
        }

        // Create highlighted span
        result.push({
          type: 'element',
          tagName: 'span',
          properties: { dataHl: '' },
          children: [{ type: 'text', value: textToHighlight }],
        });

        if (after) {
          // Recursively process the remaining text in case there are more matches
          const remainingChildren = wrapTextInHighlightSpan(
            [{ type: 'text', value: after }],
            textToHighlight,
          );
          result.push(...remainingChildren);
        }
      } else {
        result.push(child);
      }
    } else if (child.type === 'element' && child.children) {
      // Recursively process element children
      result.push({
        ...child,
        children: wrapTextInHighlightSpan(child.children, textToHighlight),
      });
    } else {
      result.push(child);
    }
  }

  return result;
}

/**
 * Recursively finds and modifies line elements in a HAST tree.
 *
 * @param node - The node to process
 * @param emphasizedLines - Map of line numbers to their emphasis metadata
 */
function addEmphasisToLines(
  node: HastRoot | Element,
  emphasizedLines: Map<number, EmphasisMeta>,
): void {
  if (!('children' in node) || !node.children) {
    return;
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
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
        if (meta.highlightText) {
          // For text highlight, wrap the specific text in a span with data-hl
          // Don't add data-hl to the line itself
          child.children = wrapTextInHighlightSpan(child.children, meta.highlightText);
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
      }
    }

    // Recurse into children (for frames containing lines)
    addEmphasisToLines(child, emphasizedLines);
  }
}

/**
 * Source enhancer that adds emphasis to code lines based on `@highlight` comments.
 *
 * Supports four patterns:
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
 * Emphasized lines receive a `data-hl` attribute on their `<span class="line">` element.
 *
 * @param root - The HAST root node to enhance
 * @param comments - Comments extracted from the source code, keyed by line number
 * @param _fileName - The name of the file being processed (unused)
 * @returns The enhanced HAST root node with emphasis attributes added
 *
 * @example
 * ```ts
 * import { enhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
 *
 * const enhancers = [enhanceCodeEmphasis];
 * ```
 */
export const enhanceCodeEmphasis: SourceEnhancer = (
  root: HastRoot,
  comments: SourceComments | undefined,
): HastRoot => {
  if (!comments || Object.keys(comments).length === 0) {
    return root;
  }

  const directives = parseEmphasisDirectives(comments);

  if (directives.length === 0) {
    return root;
  }

  const lineElements = buildLineElementMap(root);
  const emphasizedLines = calculateEmphasizedLines(directives, lineElements);

  if (emphasizedLines.size === 0) {
    return root;
  }

  addEmphasisToLines(root, emphasizedLines);

  return root;
};
