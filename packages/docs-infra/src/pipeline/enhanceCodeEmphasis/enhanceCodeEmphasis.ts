import type { Element } from 'hast';
import type { HastRoot, SourceComments, SourceEnhancer } from '../../CodeHighlighter/types';

/**
 * The prefix used to identify emphasis comments in source code.
 * Comments starting with this prefix will be processed for emphasis.
 */
export const EMPHASIS_COMMENT_PREFIX = '@demo see';

/**
 * Parsed emphasis directive from a comment.
 */
interface EmphasisDirective {
  /** The line number where the directive was found */
  line: number;
  /** Type of directive: 'single' for inline, 'start' for multiline start, 'end' for multiline end */
  type: 'single' | 'start' | 'end';
  /** Optional description text after the directive */
  description?: string;
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
}

/**
 * Parses emphasis comments and returns structured directives.
 *
 * Supported formats:
 * - Single line: `@demo see here` or `@demo see here with description`
 * - Multiline start: `@demo see below` or `@demo see below with description`
 * - Multiline end: `@demo see above`
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

      // Extract the content after "@demo see "
      const content = comment.slice(EMPHASIS_COMMENT_PREFIX.length).trim();

      if (content.startsWith('above')) {
        // End of multiline emphasis
        directives.push({ line, type: 'end' });
      } else if (content.startsWith('below')) {
        // Start of multiline emphasis
        const description = content.slice('below'.length).trim() || undefined;
        directives.push({
          line,
          type: 'start',
          description: description?.startsWith('where ')
            ? description.slice('where '.length)
            : description,
        });
      } else if (content.startsWith('here')) {
        // Single line emphasis
        const description = content.slice('here'.length).trim() || undefined;
        directives.push({
          line,
          type: 'single',
          description: description?.startsWith('where ')
            ? description.slice('where '.length)
            : description,
        });
      }
    }
  }

  return directives;
}

/**
 * Calculates which lines should be emphasized based on parsed directives.
 *
 * @param directives - Parsed emphasis directives
 * @returns Map of line numbers to their emphasis metadata
 */
function calculateEmphasizedLines(directives: EmphasisDirective[]): Map<number, EmphasisMeta> {
  const emphasizedLines = new Map<number, EmphasisMeta>();

  // Sort directives by line number for proper pairing
  const sortedDirectives = [...directives].sort((a, b) => a.line - b.line);

  // Process single line directives
  for (const directive of sortedDirectives) {
    if (directive.type === 'single') {
      const strong = directive.description?.endsWith('!') ?? false;
      // Strip trailing ! from description since it's just a signal for strong emphasis
      const description = strong
        ? directive.description?.slice(0, -1).trimEnd()
        : directive.description;
      emphasizedLines.set(directive.line, {
        description,
        strong,
        position: 'single',
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

      // When comments are stripped from the source, their line numbers point to where
      // the content after them ends up in the output. So for "below", the line number
      // is the FIRST line to highlight (not the line before it). For "above", the line
      // number is the line AFTER the last highlighted line.
      // Therefore: startLine = startDirective.line (not +1), endLine = directive.line - 1
      const startLine = startDirective.line;
      const endLine = directive.line - 1;

      // Skip if no lines to emphasize (e.g., adjacent comments with no content between)
      if (startLine > endLine) {
        continue;
      }

      // Check if this is a strong emphasis (description ends with !)
      const strong = startDirective.description?.endsWith('!') ?? false;
      // Strip trailing ! from description since it's just a signal for strong emphasis
      const description = strong
        ? startDirective.description?.slice(0, -1).trimEnd()
        : startDirective.description;

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

  for (const child of node.children) {
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
        // Use data-hl with optional "strong" value
        child.properties.dataHl = meta.strong ? 'strong' : '';

        if (meta.description) {
          child.properties.dataHlDescription = meta.description;
        }

        if (meta.position) {
          child.properties.dataHlPosition = meta.position;
        }
      }
    }

    // Recurse into children (for frames containing lines)
    addEmphasisToLines(child, emphasizedLines);
  }
}

/**
 * Source enhancer that adds emphasis to code lines based on `@demo` comments.
 *
 * Supports three patterns:
 *
 * 1. **Single line emphasis** - emphasizes the line containing the comment:
 *    ```jsx
 *    <h1>Heading 1</h1> {/* @demo see here *\/}
 *    ```
 *
 * 2. **Multiline emphasis** - emphasizes all lines between start and end:
 *    ```jsx
 *    // @demo see below
 *    <div>
 *      <h1>Heading 1</h1>
 *    </div>
 *    // @demo see above
 *    ```
 *
 * 3. **Multiline with description**:
 *    ```jsx
 *    // @demo see below where we add a heading
 *    <div>
 *      <h1>Heading 1</h1>
 *    </div>
 *    // @demo see above
 *    ```
 *
 * Emphasized lines receive a `data-emphasized` attribute on their `<span class="line">` element.
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
  _fileName: string,
): HastRoot => {
  if (!comments || Object.keys(comments).length === 0) {
    return root;
  }

  const directives = parseEmphasisDirectives(comments);

  if (directives.length === 0) {
    return root;
  }

  const emphasizedLines = calculateEmphasizedLines(directives);

  if (emphasizedLines.size === 0) {
    return root;
  }

  addEmphasisToLines(root, emphasizedLines);

  return root;
};
