/**
 * Extracts JSDoc comments from highlighted type declaration HAST trees.
 *
 * Operates on a `pre > code > span.frame > span.line*` HAST structure produced
 * by `formatDetailedTypeAsHast`. Walks the line elements to find comment lines
 * (containing `pl-c` spans), extracts their content, and splits the single frame
 * into multiple alternating frames at the `code.children` level — comment frames
 * carry `data-comment` for CSS hiding, non-comment frames are normal.
 *
 * Supports deep extraction for nested object types using dot-notation
 * property paths (e.g., `appearance.theme`).
 */

import type { Element, RootContent } from 'hast';
import type { HastRoot } from '../../CodeHighlighter/types';
import type { FrameRange } from '../parseSource/calculateFrameRanges';
import { restructureFrames } from '../parseSource/restructureFrames';
import { getHastTextContent } from './hastTypeUtils';

/**
 * Information extracted from a property declaration, optionally with JSDoc.
 */
export interface ExtractedTypeComment {
  /** The JSDoc description text, if a comment is present */
  description?: string;
  /** The property's type string as it appears in the declaration */
  typeText: string;
  /** Whether the property is optional (has `?:`) */
  optional: boolean;
  /** JSDoc `@default` value, if present */
  defaultValue?: string;
  /** JSDoc `@deprecated` text, if present */
  deprecated?: string;
  /** JSDoc `@see` references, if present */
  see?: string[];
  /** JSDoc `@example` text, if present */
  example?: string;
}

/**
 * Result of extracting type comments from a highlighted HAST.
 */
export interface ExtractTypePropsResult {
  /** The HAST with JSDoc comment lines wrapped in `span[data-comment]` elements */
  hast: HastRoot;
  /** Map of dot-notation property paths to their extracted comment data */
  properties: Record<string, ExtractedTypeComment>;
}

/**
 * Checks if a HAST element is a line element (`span.line`).
 */
function isLineElement(node: RootContent): node is Element {
  if (node.type !== 'element' || node.tagName !== 'span') {
    return false;
  }
  const classes = node.properties?.className;
  if (typeof classes === 'string') {
    return classes === 'line';
  }
  if (Array.isArray(classes)) {
    return classes.includes('line');
  }
  return false;
}

/**
 * Checks if a line element contains a JSDoc comment (`pl-c` classed spans).
 */
function isCommentLine(lineElement: Element): boolean {
  return lineElement.children.some(
    (child) => child.type === 'element' && child.tagName === 'span' && hasClass(child, 'pl-c'),
  );
}

/**
 * Checks if a HAST element has a specific CSS class.
 */
function hasClass(element: Element, className: string): boolean {
  const classes = element.properties?.className;
  if (Array.isArray(classes)) {
    return classes.includes(className);
  }
  if (typeof classes === 'string') {
    return classes.split(' ').includes(className);
  }
  return false;
}

/**
 * Extracts the full text content of a comment line.
 *
 * We extract ALL text from the line (not just `pl-c` spans) because the
 * syntax highlighter applies different classes to JSDoc tags (e.g. `@default`
 * may be in a `pl-k` span). Since `isCommentLine` already confirmed
 * this line is a comment, all its text belongs to the comment.
 */
function extractCommentText(lineElement: Element): string {
  return getHastTextContent(lineElement);
}

/**
 * Parses accumulated JSDoc lines into structured comment data.
 *
 * Handles both single-line and multi-line JSDoc formats.
 * Strips JSDoc markers and leading asterisks.
 */
function parseJSDocLines(commentTexts: string[]): {
  description: string;
  defaultValue?: string;
  deprecated?: string;
  see: string[];
  example?: string;
} {
  // First, extract the content lines from JSDoc syntax
  const contentLines: string[] = [];
  for (const raw of commentTexts) {
    const trimmed = raw.trim();
    // Single-line: /** text */
    if (trimmed.startsWith('/**') && trimmed.endsWith('*/')) {
      const inner = trimmed.slice(3, -2).trim();
      if (inner) {
        contentLines.push(inner);
      }
      continue;
    }
    // Start: /**
    if (trimmed.startsWith('/**')) {
      const rest = trimmed.slice(3).trim();
      if (rest) {
        contentLines.push(rest);
      }
      continue;
    }
    // End: */
    if (trimmed.endsWith('*/')) {
      let text = trimmed.slice(0, -2);
      if (text.startsWith('*')) {
        text = text.slice(1);
      }
      text = text.trimStart();
      if (text) {
        contentLines.push(text);
      }
      continue;
    }
    // Middle: * text
    let text = trimmed;
    if (text.startsWith('*')) {
      text = text.slice(1);
      // Remove exactly one leading space after the *, preserving further indentation
      if (text.startsWith(' ')) {
        text = text.slice(1);
      }
    }
    contentLines.push(text);
  }

  // Parse tags from content lines
  const see: string[] = [];
  let description = '';
  let defaultValue: string | undefined;
  let deprecated: string | undefined;
  let example: string | undefined;

  let currentTag: string | null = null;
  let currentTagLines: string[] = [];
  const descriptionLines: string[] = [];

  function flushTag() {
    if (!currentTag) {
      return;
    }
    const value = currentTagLines.join('\n').trim();
    switch (currentTag) {
      case 'default':
        defaultValue = value;
        break;
      case 'deprecated':
        deprecated = value;
        break;
      case 'see':
        if (value) {
          see.push(value);
        }
        break;
      case 'example':
        example = value;
        break;
      default:
        break;
    }
    currentTag = null;
    currentTagLines = [];
  }

  for (const line of contentLines) {
    const tagMatch = line.match(/^@(\w+)\s*(.*)?$/);
    if (tagMatch) {
      flushTag();
      currentTag = tagMatch[1];
      currentTagLines = tagMatch[2] ? [tagMatch[2]] : [];
    } else if (currentTag) {
      currentTagLines.push(line);
    } else {
      descriptionLines.push(line);
    }
  }
  flushTag();

  description = descriptionLines.join('\n').trim();

  return { description, defaultValue, deprecated, see, example };
}

/**
 * Parses a property declaration line into a name, optional flag, type, and whether it opens a nested object.
 */
function parsePropertyFromText(
  text: string,
): { name: string; optional: boolean; typeText: string; opensObject: boolean } | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:(\w+)|'([^']+)'|"([^"]+)")(\?)?\s*:\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  const name = match[1] ?? match[2] ?? match[3];
  const optional = match[4] === '?';
  let rest = match[5];

  const opensObject = rest.trimEnd().endsWith('{');

  if (opensObject) {
    rest = rest.slice(0, rest.lastIndexOf('{')).trim();
    return { name, optional, typeText: rest, opensObject };
  }

  if (rest.endsWith(';')) {
    rest = rest.slice(0, -1).trim();
  }

  return { name, optional, typeText: rest, opensObject: false };
}

/**
 * Parses inline property declarations from lines containing `{ ... }` blocks,
 * such as union branches: `| { reason: 'trigger-press'; event: MouseEvent }`.
 *
 * Splits on `;` at brace depth 0 within each `{ }` block, then parses each
 * segment with `parsePropertyFromText`.
 */
function parseInlineProperties(
  text: string,
): Array<{ name: string; optional: boolean; typeText: string }> {
  const results: Array<{ name: string; optional: boolean; typeText: string }> = [];
  let depth = 0;
  let blockStart = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) {
        blockStart = i + 1;
      }
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0 && blockStart >= 0) {
        const content = text.substring(blockStart, i).trim();
        // Split by ';' at depth 0 within the block
        const segments = splitBySemicolon(content);
        for (const seg of segments) {
          const prop = parsePropertyFromText(seg);
          if (prop) {
            results.push({ name: prop.name, optional: prop.optional, typeText: prop.typeText });
          }
        }
        blockStart = -1;
      }
    }
  }

  return results;
}

/**
 * Splits a string by `;` at brace depth 0, handling nested `{ }` properly.
 */
function splitBySemicolon(content: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '{') {
      depth += 1;
    } else if (content[i] === '}') {
      depth -= 1;
    } else if (content[i] === ';' && depth === 0) {
      const seg = content.substring(start, i).trim();
      if (seg) {
        segments.push(seg);
      }
      start = i + 1;
    }
  }
  const last = content.substring(start).trim();
  if (last) {
    segments.push(last);
  }
  return segments;
}

/**
 * Splits a type text string by top-level ` | ` separators, respecting
 * nested parentheses, angle brackets, braces, and string literals.
 */
function splitUnionMembers(typeText: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;

  for (let i = 0; i < typeText.length; i += 1) {
    const ch = typeText[i];

    // Track string literals
    if (inString) {
      if (ch === inString && typeText[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }

    // Track nesting — skip `>` when preceded by `=` (arrow `=>`)
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
    } else if (ch === '>' && typeText[i - 1] !== '=') {
      depth -= 1;
    }

    // Split on " | " at depth 0
    if (depth === 0 && ch === ' ' && typeText[i + 1] === '|' && typeText[i + 2] === ' ') {
      members.push(typeText.substring(start, i));
      start = i + 3; // skip " | "
      i += 2;
    }
  }

  members.push(typeText.substring(start));
  return members;
}

/**
 * Adds a property to the map, merging type texts as a union when a property
 * with the same path already exists (e.g., from different union branches).
 * Deduplicates identical type members.
 */
function mergeProperty(
  properties: Record<string, ExtractedTypeComment>,
  path: string,
  newProp: ExtractedTypeComment,
): void {
  if (path in properties) {
    const existing = properties[path];
    // Collect existing members and deduplicate
    const existingMembers = splitUnionMembers(existing.typeText);
    const newMembers = splitUnionMembers(newProp.typeText);
    const seen = new Set(existingMembers);
    for (const member of newMembers) {
      if (!seen.has(member)) {
        existingMembers.push(member);
        seen.add(member);
      }
    }
    existing.typeText = existingMembers.join(' | ');
    if (newProp.optional) {
      existing.optional = true;
    }
  } else {
    properties[path] = newProp;
  }
}

/**
 * Navigates from a HAST root to the frame element containing all line spans.
 */
function findFrameElement(hast: HastRoot): { frame: Element; code: Element } | undefined {
  const pre = hast.children[0];
  if (!pre || pre.type !== 'element' || pre.tagName !== 'pre') {
    return undefined;
  }
  const code = pre.children[0];
  if (!code || code.type !== 'element' || code.tagName !== 'code') {
    return undefined;
  }
  const frame = code.children[0];
  if (!frame || frame.type !== 'element' || !hasClass(frame, 'frame')) {
    return undefined;
  }
  return { frame, code };
}

/**
 * Walks the line elements of the frame, identifies which lines are JSDoc comments,
 * and returns the line numbers for comment vs non-comment ranges.
 */
function classifyLines(frame: Element): {
  /** Whether each line number is a comment line */
  commentLines: Set<number>;
  /** Total number of lines */
  totalLines: number;
} {
  const commentLines = new Set<number>();
  let totalLines = 0;

  for (const child of frame.children) {
    if (!isLineElement(child)) {
      continue;
    }
    const ln = child.properties?.dataLn;
    if (typeof ln !== 'number') {
      continue;
    }
    totalLines = Math.max(totalLines, ln);
    if (isCommentLine(child)) {
      commentLines.add(ln);
    }
  }

  return { commentLines, totalLines };
}

/**
 * Builds an ordered array of FrameRange objects that split lines into
 * alternating comment and non-comment ranges.
 */
function buildCommentFrameRanges(commentLines: Set<number>, totalLines: number): FrameRange[] {
  if (totalLines === 0) {
    return [];
  }

  const ranges: FrameRange[] = [];
  let rangeStart = 1;
  let isComment = commentLines.has(1);

  for (let ln = 2; ln <= totalLines; ln += 1) {
    const lineIsComment = commentLines.has(ln);
    if (lineIsComment !== isComment) {
      ranges.push({
        startLine: rangeStart,
        endLine: ln - 1,
        type: isComment ? 'comment' : 'normal',
      });
      rangeStart = ln;
      isComment = lineIsComment;
    }
  }

  // Close the last range
  ranges.push({
    startLine: rangeStart,
    endLine: totalLines,
    type: isComment ? 'comment' : 'normal',
  });

  return ranges;
}

/**
 * Extracts JSDoc comments from a highlighted type declaration HAST and returns
 * a restructured HAST (single frame split into alternating comment/non-comment frames
 * via `restructureFrames`) plus a map of property paths to extracted data.
 *
 * Property paths use dot-notation for nested object types, such as
 * "appearance.theme" for a property "theme" nested inside "appearance".
 */
export function extractTypeProps(hast: HastRoot): ExtractTypePropsResult {
  const result = findFrameElement(hast);
  if (!result) {
    return { hast, properties: {} };
  }

  const { frame, code } = result;
  const properties: Record<string, ExtractedTypeComment> = {};

  // Track JSDoc comment accumulation
  let pendingCommentTexts: string[] | null = null;
  // Track nesting path for deep extraction
  const pathStack: string[] = [];

  // Walk lines to extract property data and classify comment lines
  const children = frame.children;
  for (const child of children) {
    if (!isLineElement(child)) {
      continue;
    }

    const lineText = getHastTextContent(child);

    if (isCommentLine(child)) {
      if (pendingCommentTexts === null) {
        pendingCommentTexts = [];
      }
      pendingCommentTexts.push(extractCommentText(child));
      continue;
    }

    // Non-comment line
    if (pendingCommentTexts !== null) {
      const prop = parsePropertyFromText(lineText);
      if (prop) {
        const parsed = parseJSDocLines(pendingCommentTexts);
        const path = pathStack.length > 0 ? [...pathStack, prop.name].join('.') : prop.name;

        const extracted: ExtractedTypeComment = {
          description: parsed.description,
          typeText: prop.typeText,
          optional: prop.optional,
        };
        if (parsed.defaultValue !== undefined) {
          extracted.defaultValue = parsed.defaultValue;
        }
        if (parsed.deprecated !== undefined) {
          extracted.deprecated = parsed.deprecated;
        }
        if (parsed.see.length > 0) {
          extracted.see = parsed.see;
        }
        if (parsed.example !== undefined) {
          extracted.example = parsed.example;
        }

        mergeProperty(properties, path, extracted);

        if (prop.opensObject) {
          pathStack.push(prop.name);
        }
      } else {
        // Try parsing inline properties (e.g., from union branches: | { a: string; b: number })
        const inlineProps = parseInlineProperties(lineText);
        for (const inlineProp of inlineProps) {
          const path =
            pathStack.length > 0 ? [...pathStack, inlineProp.name].join('.') : inlineProp.name;
          mergeProperty(properties, path, {
            typeText: inlineProp.typeText,
            optional: inlineProp.optional,
          });
        }
      }
      pendingCommentTexts = null;
    } else {
      const prop = parsePropertyFromText(lineText);
      if (prop) {
        const path = pathStack.length > 0 ? [...pathStack, prop.name].join('.') : prop.name;
        mergeProperty(properties, path, {
          typeText: prop.typeText,
          optional: prop.optional,
        });
        if (prop.opensObject) {
          pathStack.push(prop.name);
        }
      } else {
        // Try parsing inline properties (e.g., from union branches)
        const inlineProps = parseInlineProperties(lineText);
        for (const inlineProp of inlineProps) {
          const path =
            pathStack.length > 0 ? [...pathStack, inlineProp.name].join('.') : inlineProp.name;
          mergeProperty(properties, path, {
            typeText: inlineProp.typeText,
            optional: inlineProp.optional,
          });
        }
      }
    }

    // Track closing braces to pop path stack.
    // Walk HAST children to count braces only in code tokens, skipping string
    // literals (pl-s) where braces are part of the string value.
    if (pathStack.length > 0) {
      let depth = 0;
      for (const span of child.children) {
        if (span.type === 'element' && hasClass(span, 'pl-s')) {
          continue;
        }
        let text = '';
        if (span.type === 'text') {
          text = span.value;
        } else if (span.type === 'element') {
          text = getHastTextContent(span);
        }
        for (const ch of text) {
          if (ch === '{') {
            depth += 1;
          } else if (ch === '}') {
            depth -= 1;
          }
        }
      }
      for (let d = depth; d < 0 && pathStack.length > 0; d += 1) {
        pathStack.pop();
      }
    }
  }

  // Build frame ranges from comment classification and restructure via restructureFrames
  const { commentLines, totalLines } = classifyLines(frame);
  if (commentLines.size > 0) {
    const frameRanges = buildCommentFrameRanges(commentLines, totalLines);

    // Create a virtual HastRoot wrapping code.children so restructureFrames can operate on it
    const virtualRoot: HastRoot = {
      type: 'root',
      children: code.children as RootContent[],
      data: { totalLines },
    };

    restructureFrames(virtualRoot, frameRanges, new Map());

    // Apply the restructured frames back to code
    code.children = virtualRoot.children as typeof code.children;
  }

  return { hast, properties };
}
