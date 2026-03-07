/**
 * Extracts JSDoc comments from highlighted type declaration HAST trees.
 *
 * Operates on a `pre > code > span.frame > span.line*` HAST structure produced
 * by `formatDetailedTypeAsHast`. Walks the HAST span elements (pl-v, pl-k, pl-en,
 * pl-s, pl-c, etc.) to structurally identify property declarations, extract their
 * types, and associate pending JSDoc comments.
 *
 * Splits the single frame into multiple alternating frames at the `code.children`
 * level — comment frames carry `data-comment` for CSS hiding, non-comment frames
 * are normal.
 *
 * Supports deep extraction for nested object types using dot-notation
 * property paths (e.g., `appearance.theme`).
 */

import type { Element, ElementContent, RootContent } from 'hast';
import type { HastRoot } from '../../CodeHighlighter/types';
import type { FrameRange } from '../parseSource/calculateFrameRanges';
import { restructureFrames } from '../parseSource/restructureFrames';
import {
  getHastTextContent,
  getShallowTextContent,
  hasClass,
  isCommentSpan,
  isEntityNameSpan,
  isKeywordSpan,
  isLineSpan,
  isPropertyNameSpan,
  isStringLiteralSpan,
} from './hastTypeUtils';

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
 * Checks if a line element contains a JSDoc comment (`pl-c` classed spans).
 */
function isCommentLine(lineElement: Element): boolean {
  return lineElement.children.some((child) => child.type === 'element' && isCommentSpan(child));
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
 * Parsed property data extracted from HAST line tokens.
 * Each property carries an array of union branches (split at top-level `|`
 * keywords in the HAST) so that merge/dedupe operates on individual members
 * rather than pre-joined strings.
 */
interface ParsedProperty {
  name: string;
  optional: boolean;
  /** Individual union branches, split at top-level `|` keywords in the HAST */
  typeBranches: string[];
  opensObject: boolean;
}

/**
 * Internal accumulator for merging the same property across union branches.
 * Each branch's type text is stored as a separate entry to allow whole-branch
 * dedupe without ever splitting a merged string.
 */
interface PropertyAccumulator {
  description?: string;
  defaultValue?: string;
  deprecated?: string;
  see?: string[];
  example?: string;
  optional: boolean;
  /** Deduped type strings, one per union branch */
  branches: string[];
  /** Set of branch strings for O(1) dedupe lookups */
  branchKeys: Set<string>;
}

/**
 * Extracts property declarations from a line's HAST children by walking span tokens.
 *
 * Recognizes the patterns produced by Starry Night:
 * - Regular:      `<pl-v>"name"` → `<pl-k>":"` → type tokens → `";"`
 * - Optional:     `<pl-v>"name"` → `<pl-k>"?:"` → type tokens → `";"`
 * - Quoted:       `<pl-s>"name"` → `<pl-k>":"` or `<pl-k>"?:"` → type tokens
 * - Fn name:      `<pl-en>"name"` → `<pl-k>":"` → type tokens
 *
 * For inline union branches (e.g., `| { a: string; b: number }`), multiple
 * properties can be extracted from a single line — the function re-enters
 * property detection after each `;` inside a `{ }` block.
 */
function extractPropertiesFromLine(children: ElementContent[]): ParsedProperty[] {
  const results: ParsedProperty[] = [];

  let i = 0;
  while (i < children.length) {
    const node = children[i];

    // Skip text nodes (brace tracking happens inside collectTypeTokens)
    if (node.type === 'text') {
      i += 1;
      continue;
    }

    if (node.type !== 'element') {
      i += 1;
      continue;
    }

    // Detect a property name: pl-v, pl-s (quoted), or pl-en (function-style)
    const isName = isPropertyNameSpan(node) || isStringLiteralSpan(node) || isEntityNameSpan(node);

    if (isName) {
      const name = getShallowTextContent(node);

      // Look ahead for the colon keyword (pl-k containing ":" or "?:")
      const colonIdx = findColonKeyword(children, i + 1);
      if (colonIdx >= 0) {
        const colonText = getShallowTextContent(children[colonIdx] as Element);
        const optional = colonText.startsWith('?');

        // Collect type tokens starting after the colon
        const { typeBranches, opensObject, endIndex } = collectTypeTokens(children, colonIdx + 1);

        results.push({ name, optional, typeBranches, opensObject });
        i = endIndex;
        continue;
      }
    }

    i += 1;
  }

  return results;
}

/**
 * Finds the next `<pl-k>` containing `:` or `?:` after `startIdx`,
 * skipping only whitespace text nodes. Returns -1 if no colon found
 * before a non-whitespace, non-keyword token.
 */
function findColonKeyword(children: ElementContent[], startIdx: number): number {
  for (let j = startIdx; j < children.length; j += 1) {
    const node = children[j];
    if (node.type === 'text') {
      // Allow whitespace between name and colon
      if (node.value.trim() === '') {
        continue;
      }
      return -1;
    }
    if (node.type === 'element' && isKeywordSpan(node)) {
      const text = getShallowTextContent(node);
      if (text === ':' || text === '?:') {
        return j;
      }
    }
    return -1;
  }
  return -1;
}

/**
 * Collects type tokens after a colon, splitting at top-level `|` keywords.
 *
 * Tracks depth through `{}`, `()`, `[]` (in text nodes) and `<>` (in `pl-k`
 * keyword spans). A `pl-k` element containing just `|` at all-zero depth is
 * treated as a union separator — the tokens before and after it become
 * separate branches.
 *
 * Stops at `;` at all-zero depth, or `}` making brace depth negative.
 * Returns the branches, whether the type opens a nested object (`{` at end),
 * and the index to resume scanning from.
 */
function collectTypeTokens(
  children: ElementContent[],
  startIdx: number,
): { typeBranches: string[]; opensObject: boolean; endIndex: number } {
  const allBranches: string[][] = [[]];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let genericDepth = 0;
  let endIndex = children.length;

  for (let j = startIdx; j < children.length; j += 1) {
    const node = children[j];
    const current = allBranches[allBranches.length - 1];

    if (node.type === 'text') {
      const value = node.value;
      for (let k = 0; k < value.length; k += 1) {
        const ch = value[k];
        if (ch === '{') {
          braceDepth += 1;
        } else if (ch === '}') {
          braceDepth -= 1;
          if (braceDepth < 0) {
            // Exiting the enclosing inline branch object — stop here
            const before = value.substring(0, k).trimEnd();
            if (before) {
              current.push(before);
            }
            endIndex = j + 1;
            return {
              typeBranches: allBranches.map((b) => b.join('').trim()),
              opensObject: false,
              endIndex,
            };
          }
        } else if (ch === '(') {
          parenDepth += 1;
        } else if (ch === ')') {
          parenDepth -= 1;
        } else if (ch === '[') {
          bracketDepth += 1;
        } else if (ch === ']') {
          bracketDepth -= 1;
        } else if (
          ch === ';' &&
          braceDepth === 0 &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          genericDepth === 0
        ) {
          // End of property at top level — trim and return
          const before = value.substring(0, k).trimEnd();
          if (before) {
            current.push(before);
          }
          endIndex = j + 1;
          return {
            typeBranches: allBranches.map((b) => b.join('').trim()),
            opensObject: false,
            endIndex,
          };
        }
      }
      current.push(value);
    } else if (node.type === 'element') {
      const text = getTokenText(node);

      // Detect top-level | keyword → start a new branch
      if (
        isKeywordSpan(node) &&
        text === '|' &&
        braceDepth === 0 &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        genericDepth === 0
      ) {
        allBranches.push([]);
        continue;
      }

      // Track generic depth for < and > keywords (not => or >=)
      if (isKeywordSpan(node)) {
        if (text === '<') {
          genericDepth += 1;
        } else if (text === '>') {
          genericDepth -= 1;
        }
      }

      // Track braces in element text (existing safety net)
      for (const ch of text) {
        if (ch === '{') {
          braceDepth += 1;
        } else if (ch === '}') {
          braceDepth -= 1;
        }
      }
      current.push(text);
    }
  }

  endIndex = children.length;
  const lastText = allBranches[allBranches.length - 1].join('').trim();

  // Check if single-branch type ends with `{` (opens a nested object)
  const opensObject = allBranches.length === 1 && lastText.endsWith('{') && braceDepth > 0;
  if (opensObject) {
    allBranches[allBranches.length - 1] = [lastText.slice(0, -1).trim()];
  }

  return {
    typeBranches: allBranches.map((b) => b.join('').trim()),
    opensObject,
    endIndex,
  };
}

/**
 * Gets the text content of a HAST element token for type building.
 * For string literal spans (pl-s), wraps the content in quotes to
 * preserve the original form.
 */
function getTokenText(node: Element): string {
  const text = getShallowTextContent(node);
  if (isStringLiteralSpan(node)) {
    // Starry Night strips quotes from pl-s content; restore them
    // Check if the text already has quotes
    if (
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"'))
    ) {
      return text;
    }
    return `'${text}'`;
  }
  return text;
}

/**
 * Adds property branches to the accumulator map.
 * Each call contributes the union branches from a single property occurrence
 * (which may itself be a union like `MouseEvent | KeyboardEvent`).
 * Dedupe is exact string comparison on each branch — no splitting needed.
 */
function mergeProperty(
  accumulators: Record<string, PropertyAccumulator>,
  path: string,
  typeBranches: string[],
  comment: Partial<
    Pick<
      PropertyAccumulator,
      'description' | 'defaultValue' | 'deprecated' | 'see' | 'example' | 'optional'
    >
  >,
): void {
  if (path in accumulators) {
    const acc = accumulators[path];
    for (const branch of typeBranches) {
      if (branch && !acc.branchKeys.has(branch)) {
        acc.branches.push(branch);
        acc.branchKeys.add(branch);
      }
    }
    if (comment.optional) {
      acc.optional = true;
    }
  } else {
    const nonEmpty = typeBranches.filter(Boolean);
    accumulators[path] = {
      description: comment.description,
      defaultValue: comment.defaultValue,
      deprecated: comment.deprecated,
      see: comment.see,
      example: comment.example,
      optional: comment.optional ?? false,
      branches: nonEmpty,
      branchKeys: new Set(nonEmpty),
    };
  }
}

/**
 * Converts the internal accumulator map to the public ExtractedTypeComment map.
 * Branches are joined with ` | ` to produce the final typeText.
 */
function finalizeProperties(
  accumulators: Record<string, PropertyAccumulator>,
): Record<string, ExtractedTypeComment> {
  const properties: Record<string, ExtractedTypeComment> = {};
  for (const [path, acc] of Object.entries(accumulators)) {
    const extracted: ExtractedTypeComment = {
      typeText: acc.branches.join(' | '),
      optional: acc.optional,
    };
    if (acc.description) {
      extracted.description = acc.description;
    }
    if (acc.defaultValue !== undefined) {
      extracted.defaultValue = acc.defaultValue;
    }
    if (acc.deprecated !== undefined) {
      extracted.deprecated = acc.deprecated;
    }
    if (acc.see && acc.see.length > 0) {
      extracted.see = acc.see;
    }
    if (acc.example !== undefined) {
      extracted.example = acc.example;
    }
    properties[path] = extracted;
  }
  return properties;
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
    if (!isLineSpan(child)) {
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
  const accumulators: Record<string, PropertyAccumulator> = {};

  // Track JSDoc comment accumulation
  let pendingCommentTexts: string[] | null = null;
  // Track nesting path for deep extraction
  const pathStack: string[] = [];

  // Walk lines to extract property data and classify comment lines
  const children = frame.children;
  for (const child of children) {
    if (!isLineSpan(child)) {
      continue;
    }

    if (isCommentLine(child)) {
      if (pendingCommentTexts === null) {
        pendingCommentTexts = [];
      }
      pendingCommentTexts.push(extractCommentText(child));
      continue;
    }

    // Non-comment line: extract properties from HAST tokens
    const props = extractPropertiesFromLine(child.children);

    if (pendingCommentTexts !== null && props.length > 0) {
      // Attach JSDoc comment to the first property on this line
      const firstProp = props[0];
      const parsed = parseJSDocLines(pendingCommentTexts);
      const path = pathStack.length > 0 ? [...pathStack, firstProp.name].join('.') : firstProp.name;

      mergeProperty(accumulators, path, firstProp.typeBranches, {
        description: parsed.description,
        defaultValue: parsed.defaultValue,
        deprecated: parsed.deprecated,
        see: parsed.see.length > 0 ? parsed.see : undefined,
        example: parsed.example,
        optional: firstProp.optional,
      });

      if (firstProp.opensObject) {
        pathStack.push(firstProp.name);
      }

      // Remaining properties on the same line (e.g., inline union: `| { a: T; b: U }`)
      for (let pi = 1; pi < props.length; pi += 1) {
        const prop = props[pi];
        const propPath = pathStack.length > 0 ? [...pathStack, prop.name].join('.') : prop.name;
        mergeProperty(accumulators, propPath, prop.typeBranches, { optional: prop.optional });
      }

      pendingCommentTexts = null;
    } else {
      // No pending comment
      for (const prop of props) {
        const path = pathStack.length > 0 ? [...pathStack, prop.name].join('.') : prop.name;
        mergeProperty(accumulators, path, prop.typeBranches, { optional: prop.optional });
        if (prop.opensObject) {
          pathStack.push(prop.name);
        }
      }
      if (pendingCommentTexts !== null) {
        pendingCommentTexts = null;
      }
    }

    // Track closing braces to pop path stack.
    // Walk HAST children to count braces, skipping string
    // literals (pl-s) where braces are part of the string value.
    if (pathStack.length > 0) {
      let depth = 0;
      for (const span of child.children) {
        if (span.type === 'element' && isStringLiteralSpan(span)) {
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

  return { hast, properties: finalizeProperties(accumulators) };
}
