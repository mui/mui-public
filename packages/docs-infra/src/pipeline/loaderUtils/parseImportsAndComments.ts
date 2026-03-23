import * as path from 'path-module';
import { fileUrlToPortablePath, portablePathToFileUrl } from './fileUrlToPortablePath';

/**
 * Comment prefixes for tool-specific ignore directives that should be stripped
 * from documentation code blocks by default. These comments are noise in docs
 * and don't provide value to the reader.
 */
export const IGNORE_COMMENT_PREFIXES = [
  'prettier-ignore',
  'eslint-disable',
  '@ts-ignore',
  '@ts-expect-error',
  '@ts-nocheck',
];

/**
 * Represents a single import name with its properties.
 */
export interface ImportName {
  /** The imported name or identifier */
  name: string;
  /** The alias used when importing (e.g., 'as newName') */
  alias?: string;
  /** The type of import: default, named, or namespace (*) */
  type: 'default' | 'named' | 'namespace';
  /** Whether this is a TypeScript type-only import */
  isType?: boolean;
}

/**
 * Represents the position of an import path in the source code.
 */
export interface ImportPathPosition {
  /** The start index of the import path (including quotes) */
  start: number;
  /** The end index of the import path (including quotes) */
  end: number;
}

/**
 * Represents an import from a relative path (starts with ./ or ../).
 */
export interface RelativeImport {
  /** The resolved absolute URL to the imported file (file:// URL) */
  url: string;
  /** Array of imported names from this module */
  names: ImportName[];
  /** Whether TypeScript type definitions should be included for this import */
  includeTypeDefs?: true;
  /** Array of positions where this import path appears in the source code */
  positions: ImportPathPosition[];
}

/**
 * Represents an import from an external package (node_modules).
 */
export interface ExternalImport {
  /** Array of imported names from this external package */
  names: ImportName[];
  /** Array of positions where this import path appears in the source code */
  positions: ImportPathPosition[];
}

/**
 * The result of parsing import statements from source code.
 */
export interface ImportsAndComments {
  /** Map of relative import paths to their import details */
  relative: Record<string, RelativeImport>;
  /** Map of external package names to their import details */
  externals: Record<string, ExternalImport>;
  /** The processed code with comments removed (if comment processing was requested) */
  code?: string;
  /** Map of line numbers to arrays of comment content (if comment processing was requested) */
  comments?: Record<number, string[]>;
}

/**
 * Checks if a character starts a string literal.
 * @param ch - The character to check
 * @param withinMdx - Whether we're parsing within an MDX file (affects quote handling)
 * @returns True if the character starts a string literal
 */
function isStringStart(ch: string, withinMdx?: boolean): boolean {
  if (withinMdx) {
    // quotes in MDX don't create strings
    return ch === '`';
  }
  return ch === '"' || ch === "'" || ch === '`';
}

/**
 * Checks if a comment matches any of the specified prefixes for removal.
 * @param commentText - The full comment text including comment markers
 * @param removeCommentsWithPrefix - Array of prefixes to match against
 * @returns True if the comment starts with any of the specified prefixes
 */
function matchesCommentPrefix(commentText: string, removeCommentsWithPrefix: string[]): boolean {
  return removeCommentsWithPrefix.some((prefix) => {
    // For single-line comments, check after the //
    if (commentText.startsWith('//')) {
      const content = commentText.slice(2).trim();
      return content.startsWith(prefix);
    }
    // For multi-line comments, check after the /*
    if (commentText.startsWith('/*')) {
      const content = commentText.slice(2, -2).trim();
      return content.startsWith(prefix);
    }
    return false;
  });
}

/**
 * Removes comment markers from comment text and returns the content as an array of lines.
 * @param commentText - The full comment text including markers
 * @returns Array of comment content lines with markers removed and whitespace trimmed
 */
function stripCommentMarkers(commentText: string): string[] {
  // For single-line comments, remove // and trim, return as single-item array
  if (commentText.startsWith('//')) {
    return [commentText.slice(2).trim()];
  }
  // For multi-line comments, remove /* and */, split by lines, and trim each line
  if (commentText.startsWith('/*') && commentText.endsWith('*/')) {
    const content = commentText.slice(2, -2);
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
  // Fallback: return as single-item array if format is unexpected
  return [commentText];
}

/**
 * Counts consecutive backticks starting at a given position (used for MDX code blocks).
 * @param sourceText - The source text to scan
 * @param startPos - The position to start counting from
 * @returns The number of consecutive backticks found
 */
function countBackticks(sourceText: string, startPos: number): number {
  let count = 0;
  let pos = startPos;
  while (pos < sourceText.length && sourceText[pos] === '`') {
    count += 1;
    pos += 1;
  }
  return count;
}

/**
 * Generic function to scan source code character-by-character, finding import statements
 * while correctly handling strings, comments, and template literals. Optionally processes
 * comments for removal and collection.
 *
 * @param sourceCode - The source code to scan
 * @param importDetector - Function that detects import statements at a given position
 * @param isMdxFile - Whether this is an MDX file (affects string and code block handling)
 * @param removeCommentsWithPrefix - Optional array of prefixes for comments to remove
 * @param notableCommentsPrefix - Optional array of prefixes for comments to collect
 * @returns Object containing found import statements and optionally processed code/comments
 */
function scanForImports(
  sourceCode: string,
  importDetector: (
    code: string,
    pos: number,
    positionMapper: (originalPos: number) => number,
  ) => { found: boolean; nextPos: number; statement?: any },
  isMdxFile: boolean,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): {
  statements: any[];
  code?: string;
  comments?: Record<number, string[]>;
  positionMapper?: (originalPos: number) => number;
} {
  const statements: any[] = [];
  const comments: Record<number, string[]> = {};
  const shouldProcessComments = !!(removeCommentsWithPrefix || notableCommentsPrefix);
  // Only map positions when actually stripping comments (code will differ from source)
  const shouldMapPositions = !!removeCommentsWithPrefix;
  let result = shouldProcessComments ? '' : sourceCode;
  // Track whether any comment was actually stripped (not just that the option was provided)
  let anyCommentStripped = false;

  // Position mapping from original source to processed source (after comment removal)
  const positionMapping = new Map<number, number>();
  let processedPos = 0;

  // Helper to check if a comment matches notable prefix
  const matchesNotablePrefix = (commentText: string): boolean => {
    if (!notableCommentsPrefix || notableCommentsPrefix.length === 0) {
      return false; // If no notable prefix specified, don't match any comments as notable
    }
    return notableCommentsPrefix.some((prefix) => {
      if (commentText.startsWith('//')) {
        const content = commentText.slice(2).trim();
        return content.startsWith(prefix);
      }
      if (commentText.startsWith('/*')) {
        const content = commentText.slice(2, -2).trim();
        return content.startsWith(prefix);
      }
      return false;
    });
  };
  let i = 0;
  let outputLine = 0; // Line number in output code after comment removal
  const len = sourceCode.length;
  let state:
    | 'code'
    | 'singleline-comment'
    | 'multiline-comment'
    | 'string'
    | 'template'
    | 'codeblock' = 'code';
  let stringQuote: string | null = null;
  let codeblockBacktickCount = 0; // Track how many backticks opened the current code block
  // Comment stripping variables
  let commentStart = 0;
  let commentStartOutputLine = 0;
  let lineStartPos = 0;
  let preCommentContent = '';

  while (i < len) {
    const ch = sourceCode[i];
    const next = sourceCode[i + 1];

    if (state === 'code') {
      // Track line numbers for newlines in code
      if (ch === '\n') {
        if (shouldProcessComments) {
          result += ch;
          processedPos += 1;
        }
        outputLine += 1;
        lineStartPos = i + 1;
        i += 1;
        continue;
      }

      // Check for backtick sequences (3 or more backticks start code blocks in MDX)
      if (isMdxFile && ch === '`') {
        // Count consecutive backticks
        const backtickCount = countBackticks(sourceCode, i);
        if (backtickCount >= 3) {
          state = 'codeblock';
          codeblockBacktickCount = backtickCount;
          if (shouldProcessComments) {
            result += sourceCode.slice(i, i + backtickCount);
            processedPos += backtickCount;
          }
          i += backtickCount;
          continue;
        }
      }
      // Start of single-line comment
      if (ch === '/' && next === '/') {
        if (shouldProcessComments) {
          commentStart = i;
          commentStartOutputLine = outputLine;
          // Remove content that was already added to result for this line
          const contentSinceLineStart = sourceCode.slice(lineStartPos, commentStart);
          result = result.slice(0, result.length - contentSinceLineStart.length);
          processedPos -= contentSinceLineStart.length;
          preCommentContent = contentSinceLineStart;
        }
        state = 'singleline-comment';
        i += 2;
        continue;
      }
      // Start of multi-line comment
      if (ch === '/' && next === '*') {
        if (shouldProcessComments) {
          commentStart = i;
          commentStartOutputLine = outputLine;
          // Remove content that was already added to result for this line
          const contentSinceLineStart = sourceCode.slice(lineStartPos, commentStart);
          result = result.slice(0, result.length - contentSinceLineStart.length);
          processedPos -= contentSinceLineStart.length;
          preCommentContent = contentSinceLineStart;
        }
        state = 'multiline-comment';
        i += 2;
        continue;
      }
      // Start of string
      if (isStringStart(ch, isMdxFile)) {
        state = ch === '`' ? 'template' : 'string';
        stringQuote = ch;
        if (shouldProcessComments) {
          result += ch;
          processedPos += 1;
        }
        i += 1;
        continue;
      }

      // Update position mapping for current position
      if (shouldProcessComments) {
        positionMapping.set(i, processedPos);
      }

      // Create position mapper function
      const positionMapper = (originalPos: number): number => {
        if (!shouldMapPositions) {
          return originalPos; // No comment stripping, positions are unchanged
        }
        // Find the closest mapped position
        let closest = 0;
        positionMapping.forEach((procPos, origPos) => {
          if (origPos <= originalPos && origPos > closest) {
            closest = origPos;
          }
        });
        const offset = originalPos - closest;
        return (positionMapping.get(closest) || 0) + offset;
      };

      // Use the provided import detector on the original source code
      const detection = importDetector(sourceCode, i, positionMapper);
      if (detection.found) {
        if (detection.statement) {
          statements.push(detection.statement);
        }
        // Copy the detected import to result if we're building one
        if (shouldProcessComments) {
          const importText = sourceCode.slice(i, detection.nextPos);
          result += importText;
          processedPos += importText.length;
        }
        i = detection.nextPos;
        continue;
      }

      if (shouldProcessComments) {
        result += ch;
        processedPos += 1;
      }
      i += 1;
      continue;
    }
    if (state === 'singleline-comment') {
      if (ch === '\n') {
        if (shouldProcessComments) {
          // End of single-line comment
          const commentText = sourceCode.slice(commentStart, i);

          const shouldStrip =
            removeCommentsWithPrefix && matchesCommentPrefix(commentText, removeCommentsWithPrefix);
          const isNotable = matchesNotablePrefix(commentText);

          // Collect comments if they're notable (all stripped comments when no prefix specified, or notable comments when prefix specified)
          const shouldCollect = (shouldStrip && !notableCommentsPrefix) || isNotable;

          if (shouldCollect) {
            if (!comments[commentStartOutputLine]) {
              comments[commentStartOutputLine] = [];
            }
            comments[commentStartOutputLine].push(...stripCommentMarkers(commentText));
          }

          if (shouldStrip) {
            anyCommentStripped = true;
            // Check if comment is the only thing on its line (ignoring whitespace)
            const isCommentOnlyLine = preCommentContent.trim() === '';

            if (isCommentOnlyLine) {
              // Don't add the pre-comment content or newline for comment-only lines
              // Skip the newline entirely
            } else {
              // Comment is inline, keep the pre-comment content (with trailing whitespace trimmed) and newline
              result += preCommentContent.trimEnd();
              result += '\n';
              processedPos += preCommentContent.trimEnd().length + 1;
              outputLine += 1;
            }
          } else {
            // Keep the comment and newline
            result += preCommentContent;
            result += commentText;
            result += '\n';
            processedPos += preCommentContent.length + commentText.length + 1;
            outputLine += 1;
          }
          preCommentContent = '';
          lineStartPos = i + 1;
        }
        state = 'code';
      }
      i += 1;
      continue;
    }
    if (state === 'multiline-comment') {
      if (ch === '*' && next === '/') {
        if (shouldProcessComments) {
          // End of multi-line comment
          const commentText = sourceCode.slice(commentStart, i + 2);

          const shouldStrip =
            removeCommentsWithPrefix && matchesCommentPrefix(commentText, removeCommentsWithPrefix);
          const isNotable = matchesNotablePrefix(commentText);

          // Collect comments if they're notable (all stripped comments when no prefix specified, or notable comments when prefix specified)
          const shouldCollect = (shouldStrip && !notableCommentsPrefix) || isNotable;

          if (shouldCollect) {
            if (!comments[commentStartOutputLine]) {
              comments[commentStartOutputLine] = [];
            }
            comments[commentStartOutputLine].push(...stripCommentMarkers(commentText));
          }

          if (shouldStrip) {
            anyCommentStripped = true;
            // Find the end of the comment and check what's after
            const afterCommentPos = i + 2;
            let afterCommentContent = '';
            let nextNewlinePos = sourceCode.indexOf('\n', afterCommentPos);
            if (nextNewlinePos === -1) {
              nextNewlinePos = sourceCode.length;
            }
            afterCommentContent = sourceCode.slice(afterCommentPos, nextNewlinePos);

            // Check for JSX comment syntax: {/* comment */}
            // preCommentContent ends with '{' (ignoring whitespace) and afterCommentContent starts with '}' (ignoring whitespace)
            const trimmedPreComment = preCommentContent.trimEnd();
            const trimmedAfterComment = afterCommentContent.trimStart();
            const isJsxComment =
              trimmedPreComment.endsWith('{') && trimmedAfterComment.startsWith('}');

            // For JSX comments, check if removing the braces leaves only whitespace
            const preCommentWithoutBrace = isJsxComment
              ? trimmedPreComment.slice(0, -1)
              : preCommentContent;
            const afterCommentWithoutBrace = isJsxComment
              ? trimmedAfterComment.slice(1)
              : afterCommentContent;

            const isCommentOnlyLines =
              preCommentWithoutBrace.trim() === '' && afterCommentWithoutBrace.trim() === '';

            if (isCommentOnlyLines) {
              // Skip the entire comment and everything up to and including the next newline
              // For JSX comments, this also skips the surrounding braces
              i = nextNewlinePos;
              if (i < len && sourceCode[i] === '\n') {
                // Skip the newline entirely - advance to the character after it
                i += 1;
                lineStartPos = i;
              } else {
                lineStartPos = i;
              }
              state = 'code';
              preCommentContent = '';
              continue;
            } else if (isJsxComment) {
              // JSX comment is inline with other code - strip the braces too
              // e.g., `<Footer /> {/* @highlight */}` -> `<Footer />`
              result += preCommentWithoutBrace.trimEnd();
              processedPos += preCommentWithoutBrace.trimEnd().length;
              // Skip past the closing brace after the comment
              i = afterCommentPos;
              while (i < nextNewlinePos && /\s/.test(sourceCode[i])) {
                i += 1;
              }
              if (i < nextNewlinePos && sourceCode[i] === '}') {
                i += 1; // Skip the closing brace
              }
              // Don't advance past here - let the main loop continue from i
            } else {
              // Comment is inline or mixed with code, add pre-comment content (with trailing whitespace trimmed)
              result += preCommentContent.trimEnd();
              processedPos += preCommentContent.trimEnd().length;
              i += 2;
            }
          } else {
            // Keep the comment - add pre-comment content and comment
            result += preCommentContent;
            result += commentText;
            processedPos += preCommentContent.length + commentText.length;
            // Count newlines in the kept comment to update output line
            const newlineCount = (commentText.match(/\n/g) || []).length;
            outputLine += newlineCount;
            i += 2;
          }
          preCommentContent = '';
        } else {
          i += 2;
        }
        state = 'code';
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'string') {
      if (ch === '\n') {
        outputLine += 1;
        lineStartPos = i + 1;
      }
      if (ch === '\\\\') {
        if (shouldProcessComments) {
          result += sourceCode.slice(i, i + 2);
          processedPos += 2;
        }
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        state = 'code';
        stringQuote = null;
      }
      if (shouldProcessComments) {
        result += ch;
        processedPos += 1;
      }
      i += 1;
      continue;
    }
    if (state === 'template') {
      if (ch === '\n') {
        outputLine += 1;
        lineStartPos = i + 1;
      }
      if (ch === '`') {
        state = 'code';
        stringQuote = null;
        if (shouldProcessComments) {
          result += ch;
          processedPos += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '\\\\') {
        if (shouldProcessComments) {
          result += sourceCode.slice(i, i + 2);
          processedPos += 2;
        }
        i += 2;
        continue;
      }
      if (shouldProcessComments) {
        result += ch;
        processedPos += 1;
      }
      i += 1;
      continue;
    }
    if (state === 'codeblock') {
      if (ch === '\n') {
        outputLine += 1;
        lineStartPos = i + 1;
      }
      // Look for closing backticks that match or exceed the opening count
      if (ch === '`') {
        const closingBacktickCount = countBackticks(sourceCode, i);
        if (closingBacktickCount >= codeblockBacktickCount) {
          state = 'code';
          codeblockBacktickCount = 0;
          if (shouldProcessComments) {
            result += sourceCode.slice(i, i + closingBacktickCount);
            processedPos += closingBacktickCount;
          }
          i += closingBacktickCount;
          continue;
        }
      }
      if (shouldProcessComments) {
        result += ch;
        processedPos += 1;
      }
      i += 1;
      continue;
    }
    if (shouldProcessComments) {
      result += ch;
      processedPos += 1;
    }
    i += 1;
  }

  // Handle case where file ends with a comment
  if (shouldProcessComments && (state === 'singleline-comment' || state === 'multiline-comment')) {
    const commentText = sourceCode.slice(commentStart);
    const shouldStrip =
      removeCommentsWithPrefix && matchesCommentPrefix(commentText, removeCommentsWithPrefix);
    const isNotable = matchesNotablePrefix(commentText);

    // Collect comments if they're notable (all stripped comments when no prefix specified, or notable comments when prefix specified)
    const shouldCollect = (shouldStrip && !notableCommentsPrefix) || isNotable;

    if (shouldCollect) {
      if (!comments[commentStartOutputLine]) {
        comments[commentStartOutputLine] = [];
      }
      comments[commentStartOutputLine].push(...stripCommentMarkers(commentText));
    }

    if (shouldStrip) {
      anyCommentStripped = true;
    } else {
      result += commentText;
      processedPos += commentText.length;
    }
  }

  // Create the final position mapper for return
  const finalPositionMapper = (originalPos: number): number => {
    if (!shouldMapPositions) {
      return originalPos; // No comment stripping, positions are unchanged
    }
    // Find the closest mapped position
    let closest = 0;
    positionMapping.forEach((procPos, origPos) => {
      if (origPos <= originalPos && origPos > closest) {
        closest = origPos;
      }
    });
    const offset = originalPos - closest;
    return (positionMapping.get(closest) || 0) + offset;
  };

  // Only return code/comments/positionMapper when comments were actually stripped
  // If only notableCommentsPrefix is provided (without removeCommentsWithPrefix),
  // we collect comments but don't modify the code, so don't return it

  return {
    statements,
    ...(anyCommentStripped && {
      code: result,
      ...(Object.keys(comments).length > 0 && { comments }),
      positionMapper: finalPositionMapper,
    }),
    // If only collecting notable comments (no stripping), just return the comments
    ...(!anyCommentStripped &&
      notableCommentsPrefix &&
      Object.keys(comments).length > 0 && {
        comments,
      }),
  };
}

/**
 * Adds an import name to the target array if it doesn't already exist.
 * @param target - The array of import names to add to
 * @param name - The name of the import
 * @param type - The type of import (default, named, or namespace)
 * @param alias - Optional alias for the import
 * @param isType - Whether this is a TypeScript type-only import
 */
function addImportName(
  target: ImportName[],
  name: string,
  type: 'default' | 'named' | 'namespace',
  alias?: string,
  isType?: boolean,
) {
  const existing = target.find((n) => n.name === name && n.type === type && n.alias === alias);
  if (!existing) {
    target.push({
      name,
      ...(alias && { alias }),
      type,
      ...(isType && { isType: true }),
    });
  }
}

/**
 * Checks if a character is a valid JavaScript identifier character.
 * @param ch - The character to check
 * @returns True if the character can be part of a JavaScript identifier
 */
function isIdentifierChar(ch: string): boolean {
  return /[a-zA-Z0-9_$]/.test(ch);
}

/**
 * Checks if a character is whitespace.
 * @param ch - The character to check
 * @returns True if the character is whitespace
 */
function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Skips whitespace characters and returns the next non-whitespace position.
 * @param text - The text to scan
 * @param start - The starting position
 * @returns The position of the next non-whitespace character
 */
function skipWhitespace(text: string, start: number): number {
  let pos = start;
  while (pos < text.length && isWhitespace(text[pos])) {
    pos += 1;
  }
  return pos;
}

/**
 * Reads a JavaScript identifier starting at the given position.
 * @param text - The text to read from
 * @param start - The starting position
 * @returns Object containing the identifier name and the next position
 */
function readIdentifier(text: string, start: number): { name: string; nextPos: number } {
  let pos = start;
  let name = '';

  // First character must be letter, underscore, or dollar sign
  if (pos < text.length && /[a-zA-Z_$]/.test(text[pos])) {
    name += text[pos];
    pos += 1;

    // Subsequent characters can be letters, digits, underscore, or dollar sign
    while (pos < text.length && isIdentifierChar(text[pos])) {
      name += text[pos];
      pos += 1;
    }
  }

  return { name, nextPos: pos };
}

// Helper function to read a quoted string starting at position
function readQuotedString(
  text: string,
  start: number,
): { value: string; nextPos: number; pathStart: number; pathEnd: number } {
  const quote = text[start];
  let pos = start + 1;
  let value = '';
  const pathStart = start; // Start at the opening quote

  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '\\' && pos + 1 < text.length) {
      // Skip escaped character
      pos += 2;
      continue;
    }
    if (ch === quote) {
      const pathEnd = pos + 1; // End after the closing quote
      pos += 1;
      return { value, nextPos: pos, pathStart, pathEnd };
    }
    value += ch;
    pos += 1;
  }

  // If we reach here, no closing quote was found - fallback
  return { value, nextPos: pos, pathStart, pathEnd: pos };
}

// Helper function to parse named imports from a brace-enclosed section
function parseNamedImports(
  text: string,
  start: number,
  end: number,
): Array<{ name: string; alias?: string; isType?: boolean }> {
  const imports: Array<{ name: string; alias?: string; isType?: boolean }> = [];
  let pos = start;

  while (pos < end) {
    pos = skipWhitespace(text, pos);
    if (pos >= end) {
      break;
    }

    // Handle comments within named imports
    if (pos + 1 < end && text[pos] === '/' && text[pos + 1] === '/') {
      // Skip single-line comment
      while (pos < end && text[pos] !== '\n') {
        pos += 1;
      }
      continue;
    }

    if (pos + 1 < end && text[pos] === '/' && text[pos + 1] === '*') {
      // Skip multi-line comment
      pos += 2;
      while (pos + 1 < end) {
        if (text[pos] === '*' && text[pos + 1] === '/') {
          pos += 2;
          break;
        }
        pos += 1;
      }
      continue;
    }

    // Skip comma if we encounter it
    if (text[pos] === ',') {
      pos += 1;
      continue;
    }

    // Check for 'type' keyword
    let isTypeImport = false;
    if (text.slice(pos, pos + 4) === 'type' && !isIdentifierChar(text[pos + 4] || '')) {
      isTypeImport = true;
      pos += 4;
      pos = skipWhitespace(text, pos);
    }

    // Read the import name
    const { name, nextPos } = readIdentifier(text, pos);
    if (!name) {
      pos += 1;
      continue;
    }
    pos = nextPos;

    pos = skipWhitespace(text, pos);

    // Check for 'as' keyword (alias)
    let alias: string | undefined;
    if (text.slice(pos, pos + 2) === 'as' && !isIdentifierChar(text[pos + 2] || '')) {
      pos += 2;
      pos = skipWhitespace(text, pos);
      const aliasResult = readIdentifier(text, pos);
      alias = aliasResult.name;
      pos = aliasResult.nextPos;
      pos = skipWhitespace(text, pos);
    }

    imports.push({ name, ...(alias && { alias }), ...(isTypeImport && { isType: true }) });

    // Skip comma if present
    if (text[pos] === ',') {
      pos += 1;
    }
  }

  return imports;
}

// Function to parse a single CSS @import statement
function parseCssImportStatement(
  cssCode: string,
  start: number,
): { modulePath: string | null; nextPos: number; pathStart?: number; pathEnd?: number } {
  let pos = start + 7; // Skip '@import'
  const len = cssCode.length;

  // Skip whitespace
  while (pos < len && /\s/.test(cssCode[pos])) {
    pos += 1;
  }

  let modulePath: string | null = null;
  let pathStart: number | undefined;
  let pathEnd: number | undefined;

  // Check for url() syntax
  if (cssCode.slice(pos, pos + 4) === 'url(') {
    pos += 4;
    // Skip whitespace
    while (pos < len && /\s/.test(cssCode[pos])) {
      pos += 1;
    }

    // Read the URL (quoted or unquoted)
    if (pos < len && (cssCode[pos] === '"' || cssCode[pos] === "'")) {
      const quote = cssCode[pos];
      pathStart = pos; // Start at the opening quote
      pos += 1;
      let url = '';
      while (pos < len && cssCode[pos] !== quote) {
        // Only stop at newlines - parentheses and semicolons are valid in URLs
        if (cssCode[pos] === '\n') {
          break;
        }
        if (cssCode[pos] === '\\') {
          pos += 2;
          continue;
        }
        url += cssCode[pos];
        pos += 1;
      }
      if (pos < len && cssCode[pos] === quote) {
        pathEnd = pos + 1; // End after the closing quote
        pos += 1;
        modulePath = url;
      }
      // If we didn't find the closing quote, don't set modulePath (malformed)
    } else {
      // Unquoted URL
      pathStart = pos;
      let url = '';
      while (pos < len && cssCode[pos] !== ')' && !/\s/.test(cssCode[pos])) {
        url += cssCode[pos];
        pos += 1;
      }
      pathEnd = pos;
      modulePath = url;
    }

    // Skip to closing parenthesis - if we don't find it, the url() is malformed
    while (pos < len && cssCode[pos] !== ')' && cssCode[pos] !== ';' && cssCode[pos] !== '\n') {
      pos += 1;
    }
    if (pos < len && cssCode[pos] === ')') {
      pos += 1;
      // Only consider this a valid URL if we found the closing parenthesis
    } else {
      // Malformed url() - don't set modulePath
      modulePath = null;
      pathStart = undefined;
      pathEnd = undefined;
    }
  } else if (pos < len && (cssCode[pos] === '"' || cssCode[pos] === "'")) {
    // Direct quoted import
    const quote = cssCode[pos];
    pathStart = pos; // Start at the opening quote
    pos += 1;
    let url = '';
    while (pos < len && cssCode[pos] !== quote) {
      // Stop if we hit a newline (likely malformed), but semicolons are valid in URLs
      if (cssCode[pos] === '\n') {
        break;
      }
      if (cssCode[pos] === '\\') {
        pos += 2;
        continue;
      }
      url += cssCode[pos];
      pos += 1;
    }
    if (pos < len && cssCode[pos] === quote) {
      pathEnd = pos + 1; // End after the closing quote
      pos += 1;
      modulePath = url;
    }
    // If we didn't find the closing quote, don't set modulePath (malformed import)
  }

  // Skip to semicolon or end of statement
  while (pos < len && cssCode[pos] !== ';' && cssCode[pos] !== '\n') {
    pos += 1;
  }
  if (pos < len && cssCode[pos] === ';') {
    pos += 1;
  }

  return { modulePath, nextPos: pos, pathStart, pathEnd };
}

// CSS import detector function
function detectCssImport(
  sourceText: string,
  pos: number,
  cssResult: Record<string, RelativeImport>,
  cssExternals: Record<string, ExternalImport>,
  cssFilePath: string,
  positionMapper: (originalPos: number) => number,
) {
  const ch = sourceText[pos];

  // Look for '@import' keyword
  if (
    ch === '@' &&
    sourceText.slice(pos, pos + 7) === '@import' &&
    /\s/.test(sourceText[pos + 7] || '')
  ) {
    // Parse the @import statement
    const importResult = parseCssImportStatement(sourceText, pos);
    if (
      importResult.modulePath &&
      importResult.pathStart !== undefined &&
      importResult.pathEnd !== undefined
    ) {
      // In CSS, imports are relative unless they have a protocol/hostname
      // Examples of external: "http://...", "https://...", "//example.com/style.css"
      // Examples of relative: "print.css", "./local.css", "../parent.css"
      const hasProtocol = /^https?:\/\//.test(importResult.modulePath);
      const hasHostname = /^\/\//.test(importResult.modulePath);
      const isExternal = hasProtocol || hasHostname;

      const position: ImportPathPosition = {
        start: positionMapper(importResult.pathStart),
        end: positionMapper(importResult.pathEnd),
      };

      if (isExternal) {
        if (!cssExternals[importResult.modulePath]) {
          cssExternals[importResult.modulePath] = { names: [], positions: [] };
        }
        cssExternals[importResult.modulePath].positions.push(position);
      } else {
        // Treat as relative import - normalize the path if it doesn't start with ./ or ../
        let normalizedPath = importResult.modulePath;
        if (!normalizedPath.startsWith('./') && !normalizedPath.startsWith('../')) {
          normalizedPath = `./${normalizedPath}`;
        }
        const resolvedPath = path.resolve(path.dirname(cssFilePath), normalizedPath);
        if (!cssResult[importResult.modulePath]) {
          cssResult[importResult.modulePath] = {
            url: portablePathToFileUrl(resolvedPath),
            names: [],
            positions: [],
          };
        }
        cssResult[importResult.modulePath].positions.push(position);
      }
    }
    return { found: true, nextPos: importResult.nextPos };
  }

  return { found: false, nextPos: pos };
}

/**
 * Parses CSS @import statements from CSS source code.
 * @param cssCode - The CSS source code to parse
 * @param cssFilePath - The CSS file path for resolving relative imports
 * @param cssResult - Object to store relative CSS import results
 * @param cssExternals - Object to store external CSS import results
 * @param removeCommentsWithPrefix - Optional prefixes for comments to remove
 * @param notableCommentsPrefix - Optional prefixes for comments to collect
 * @returns The parsed CSS import results with optional processed code and comments
 */
function parseCssImports(
  cssCode: string,
  cssFilePath: string,
  cssResult: Record<string, RelativeImport>,
  cssExternals: Record<string, ExternalImport>,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments {
  // Use the generic scanner with a bound detector function
  const scanResult = scanForImports(
    cssCode,
    (sourceText: string, pos: number, positionMapper: (originalPos: number) => number) =>
      detectCssImport(sourceText, pos, cssResult, cssExternals, cssFilePath, positionMapper),
    false,
    removeCommentsWithPrefix,
    notableCommentsPrefix,
  );

  return {
    relative: cssResult,
    externals: cssExternals,
    ...(scanResult.code && { code: scanResult.code }),
    ...(scanResult.comments && { comments: scanResult.comments }),
  };
}

/**
 * Parses JavaScript/TypeScript import and export-from statements from source code.
 * @param code - The source code to parse
 * @param filePath - The file path for resolving relative imports
 * @param result - Object to store relative import results
 * @param externals - Object to store external import results
 * @param isMdxFile - Whether this is an MDX file
 * @param removeCommentsWithPrefix - Optional prefixes for comments to remove
 * @param notableCommentsPrefix - Optional prefixes for comments to collect
 * @returns The parsed import results with optional processed code and comments
 */
function parseJSImports(
  code: string,
  filePath: string,
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  isMdxFile: boolean,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments {
  // Scan code for JavaScript import statements
  const scanResult = scanForImports(
    code,
    detectJavaScriptImport,
    isMdxFile,
    removeCommentsWithPrefix,
    notableCommentsPrefix,
  );

  // Now, parse each import/export statement using character-by-character parsing
  for (const { start, text } of scanResult.statements) {
    let pos = 0;
    const textLen = text.length;

    // Check if this is an export statement
    const isExport = text.startsWith('export');

    // Skip 'import' or 'export'
    pos = isExport ? 6 : 6; // Both are 6 characters
    pos = skipWhitespace(text, pos);

    // Check for 'type' keyword
    let isTypeImport = false;
    if (text.slice(pos, pos + 4) === 'type' && !isIdentifierChar(text[pos + 4] || '')) {
      isTypeImport = true;
      pos += 4;
      pos = skipWhitespace(text, pos);
    }

    // Check if this is a side-effect import (starts with quote)
    if (pos < textLen && (text[pos] === '"' || text[pos] === "'")) {
      const { value: modulePath, pathStart, pathEnd } = readQuotedString(text, pos);
      if (modulePath) {
        // Calculate the position in the original source code
        const originalPathStart = start + pathStart;
        const originalPathEnd = start + pathEnd;

        // Apply position mapping if available (for comment-stripped positions)
        let mappedStart = originalPathStart;
        let mappedEnd = originalPathEnd;
        if (scanResult.positionMapper) {
          mappedStart = scanResult.positionMapper(originalPathStart);
          mappedEnd = scanResult.positionMapper(originalPathEnd);
        }

        const position: ImportPathPosition = { start: mappedStart, end: mappedEnd };

        const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');
        if (isRelative) {
          const resolvedPath = path.resolve(path.dirname(filePath), modulePath);
          if (!result[modulePath]) {
            result[modulePath] = {
              url: portablePathToFileUrl(resolvedPath),
              names: [],
              positions: [],
            };
          }
          result[modulePath].positions.push(position);
        } else {
          if (!externals[modulePath]) {
            externals[modulePath] = { names: [], positions: [] };
          }
          externals[modulePath].positions.push(position);
        }
      }
      continue;
    }

    // Parse import specifiers
    let defaultImport: string | undefined;
    let namespaceImport: string | undefined;
    let namedImports: Array<{ name: string; alias?: string; isType?: boolean }> = [];

    // Check for default import (identifier not followed by 'from')
    if (pos < textLen && /[a-zA-Z_$]/.test(text[pos])) {
      const { name, nextPos } = readIdentifier(text, pos);
      const afterName = skipWhitespace(text, nextPos);

      // If next non-whitespace is comma or 'from', this is a default import
      if (
        afterName >= textLen ||
        text[afterName] === ',' ||
        text.slice(afterName, afterName + 4) === 'from'
      ) {
        defaultImport = name;
        pos = afterName;

        // Skip comma if present
        if (pos < textLen && text[pos] === ',') {
          pos += 1;
          pos = skipWhitespace(text, pos);
        }
      }
    }

    // Check for namespace import (* as Name)
    if (pos < textLen && text[pos] === '*') {
      pos += 1;
      pos = skipWhitespace(text, pos);

      // Expect 'as'
      if (text.slice(pos, pos + 2) === 'as') {
        pos += 2;
        pos = skipWhitespace(text, pos);

        const { name } = readIdentifier(text, pos);
        if (name) {
          namespaceImport = name;
          pos = readIdentifier(text, pos).nextPos;
          pos = skipWhitespace(text, pos);
        }
      }
    }

    // Check for named imports ({ ... })
    if (pos < textLen && text[pos] === '{') {
      pos += 1;
      const braceStart = pos;

      // Find the closing brace
      let braceDepth = 1;
      while (pos < textLen && braceDepth > 0) {
        if (text[pos] === '{') {
          braceDepth += 1;
        } else if (text[pos] === '}') {
          braceDepth -= 1;
        }
        pos += 1;
      }

      if (braceDepth === 0) {
        const braceEnd = pos - 1;
        namedImports = parseNamedImports(text, braceStart, braceEnd);
      }
    }

    // Skip to 'from' keyword
    pos = skipWhitespace(text, pos);
    while (pos < textLen && text.slice(pos, pos + 4) !== 'from') {
      pos += 1;
    }

    if (pos >= textLen || text.slice(pos, pos + 4) !== 'from') {
      continue; // No 'from' found, skip this import
    }

    pos += 4;
    pos = skipWhitespace(text, pos);

    // Read module path
    if (pos >= textLen || !(text[pos] === '"' || text[pos] === "'")) {
      continue; // No quoted module path found
    }

    const { value: modulePath, pathStart, pathEnd } = readQuotedString(text, pos);
    if (!modulePath) {
      continue;
    }

    // Calculate the position in the original source code
    const originalPathStart = start + pathStart;
    const originalPathEnd = start + pathEnd;

    const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');

    // Apply position mapping if available (for comment-stripped positions)
    let mappedStart = originalPathStart;
    let mappedEnd = originalPathEnd;
    if (scanResult.positionMapper) {
      mappedStart = scanResult.positionMapper(originalPathStart);
      mappedEnd = scanResult.positionMapper(originalPathEnd);
    }

    const position: ImportPathPosition = { start: mappedStart, end: mappedEnd };

    if (isRelative) {
      const resolvedPath = path.resolve(path.dirname(filePath), modulePath);
      if (!result[modulePath]) {
        result[modulePath] = {
          url: portablePathToFileUrl(resolvedPath),
          names: [],
          positions: [],
          ...(isTypeImport && { includeTypeDefs: true as const }),
        };
      } else if (isTypeImport && !result[modulePath].includeTypeDefs) {
        result[modulePath].includeTypeDefs = true as const;
      }

      // Add position information
      result[modulePath].positions.push(position);

      if (defaultImport) {
        addImportName(result[modulePath].names, defaultImport, 'default', undefined, isTypeImport);
      }

      if (namespaceImport) {
        addImportName(
          result[modulePath].names,
          namespaceImport,
          'namespace',
          undefined,
          isTypeImport,
        );
      }

      namedImports.forEach(({ name, alias, isType }) => {
        addImportName(result[modulePath].names, name, 'named', alias, isTypeImport || isType);
      });
    } else {
      if (!externals[modulePath]) {
        externals[modulePath] = { names: [], positions: [] };
      }

      // Add position information
      externals[modulePath].positions.push(position);

      if (defaultImport) {
        addImportName(
          externals[modulePath].names,
          defaultImport,
          'default',
          undefined,
          isTypeImport,
        );
      }

      if (namespaceImport) {
        addImportName(
          externals[modulePath].names,
          namespaceImport,
          'namespace',
          undefined,
          isTypeImport,
        );
      }

      namedImports.forEach(({ name, alias, isType }) => {
        addImportName(externals[modulePath].names, name, 'named', alias, isTypeImport || isType);
      });
    }
  }

  return {
    relative: result,
    externals,
    ...(scanResult.code && { code: scanResult.code }),
    ...(scanResult.comments && { comments: scanResult.comments }),
  };
}

/**
 * Detects JavaScript import and export-from statements at a given position in source code.
 * @param sourceText - The source text to scan
 * @param pos - The current position in the text
 * @param positionMapper - Function to map original positions to processed positions
 * @returns Object indicating if an import/export was found, the next position, and statement details
 */
function detectJavaScriptImport(
  sourceText: string,
  pos: number,
  _positionMapper: (originalPos: number) => number,
) {
  const ch = sourceText[pos];

  // Look for 'export' keyword followed by 'from' (export ... from '...')
  if (
    ch === 'e' &&
    sourceText.slice(pos, pos + 6) === 'export' &&
    (pos === 0 || /[^a-zA-Z0-9_$]/.test(sourceText[pos - 1])) &&
    /[^a-zA-Z0-9_$]/.test(sourceText[pos + 6] || '')
  ) {
    // Check if this export statement has a 'from' clause
    const exportStart = pos;
    const len = sourceText.length;
    let j = pos + 6;

    // Skip whitespace and look ahead for 'from' keyword
    let hasFrom = false;
    let tempPos = j;
    let tempBraceDepth = 0;

    while (tempPos < len) {
      const tempCh = sourceText[tempPos];
      if (tempCh === '{') {
        tempBraceDepth += 1;
      } else if (tempCh === '}') {
        tempBraceDepth -= 1;
      } else if (
        sourceText.slice(tempPos, tempPos + 4) === 'from' &&
        /\s/.test(sourceText[tempPos + 4] || '')
      ) {
        hasFrom = true;
        break;
      } else if (tempCh === ';' || (tempCh === '\n' && tempBraceDepth === 0)) {
        break;
      }
      tempPos += 1;
    }

    if (!hasFrom) {
      // This is not an export-from statement, skip it
      return { found: false, nextPos: pos };
    }

    // Now scan to find the end of the export-from statement
    let exportState: 'code' | 'string' | 'template' = 'code';
    let exportQuote: string | null = null;
    let braceDepth = 0;
    let foundFrom = false;
    let foundModulePath = false;

    while (j < len) {
      const cj = sourceText[j];
      if (exportState === 'code') {
        if (cj === ';') {
          j += 1;
          break;
        }
        if (isStringStart(cj)) {
          exportState = cj === '`' ? 'template' : 'string';
          exportQuote = cj;
          if (foundFrom) {
            foundModulePath = true;
          }
          j += 1;
          continue;
        }
        if (cj === '{') {
          braceDepth += 1;
        }
        if (cj === '}') {
          braceDepth -= 1;
        }
        if (sourceText.slice(j, j + 4) === 'from' && /\s/.test(sourceText[j + 4] || '')) {
          foundFrom = true;
        }
        if (foundModulePath && braceDepth === 0 && /\s/.test(cj)) {
          let k = j;
          while (k < len && /\s/.test(sourceText[k])) {
            k += 1;
          }
          if (k >= len || sourceText[k] === ';' || sourceText[k] === '\n') {
            if (sourceText[k] === ';') {
              j = k + 1;
            } else {
              j = k;
            }
            break;
          }
        }
      } else if (exportState === 'string') {
        if (cj === '\\') {
          j += 2;
          continue;
        }
        if (cj === exportQuote) {
          exportState = 'code';
          exportQuote = null;
        }
        j += 1;
        continue;
      } else if (exportState === 'template') {
        if (cj === '`') {
          exportState = 'code';
          exportQuote = null;
        } else if (cj === '\\') {
          j += 2;
          continue;
        }
        j += 1;
        continue;
      }
      j += 1;
    }

    const exportText = sourceText.slice(exportStart, j);
    return {
      found: true,
      nextPos: j,
      statement: { start: exportStart, end: j, text: exportText },
    };
  }

  // Look for 'import' keyword (not part of an identifier, and not preceded by @)
  if (
    ch === 'i' &&
    sourceText.slice(pos, pos + 6) === 'import' &&
    (pos === 0 || /[^a-zA-Z0-9_$@]/.test(sourceText[pos - 1])) &&
    /[^a-zA-Z0-9_$]/.test(sourceText[pos + 6] || '')
  ) {
    // Mark start of import statement
    const importStart = pos;
    const len = sourceText.length;

    // Now, scan forward to find the end of the statement (semicolon or proper end for side-effect imports)
    let j = pos + 6;
    let importState: 'code' | 'string' | 'template' = 'code';
    let importQuote: string | null = null;
    let braceDepth = 0;
    let foundFrom = false;
    let foundModulePath = false;

    while (j < len) {
      const cj = sourceText[j];
      if (importState === 'code') {
        if (cj === ';') {
          j += 1;
          break;
        }
        // Check if we're at a bare import statement (no 'from')
        if (cj === '\n' && !foundFrom && !foundModulePath && braceDepth === 0) {
          // This might be a side-effect import or end of statement
          // Look ahead to see if there's content that could be part of the import
          let k = j + 1;
          while (k < len && /\s/.test(sourceText[k])) {
            k += 1;
          }
          if (k >= len || sourceText.slice(k, k + 4) === 'from' || isStringStart(sourceText[k])) {
            // Continue, this newline is within the import
          } else {
            // This looks like the end of a side-effect import
            j += 1;
            break;
          }
        }
        if (isStringStart(cj)) {
          importState = cj === '`' ? 'template' : 'string';
          importQuote = cj;
          if (foundFrom) {
            foundModulePath = true;
          }
          j += 1;
          continue;
        }
        if (cj === '{') {
          braceDepth += 1;
        }
        if (cj === '}') {
          braceDepth -= 1;
        }
        if (sourceText.slice(j, j + 4) === 'from' && /\s/.test(sourceText[j + 4] || '')) {
          foundFrom = true;
        }
        // If we found a module path and we're back to normal code, we might be done
        if (foundModulePath && braceDepth === 0 && /\s/.test(cj)) {
          // Look ahead for semicolon or end of statement
          let k = j;
          while (k < len && /\s/.test(sourceText[k])) {
            k += 1;
          }
          if (k >= len || sourceText[k] === ';' || sourceText[k] === '\n') {
            if (sourceText[k] === ';') {
              j = k + 1;
            } else {
              j = k;
            }
            break;
          }
        }
      } else if (importState === 'string') {
        if (cj === '\\') {
          j += 2;
          continue;
        }
        if (cj === importQuote) {
          importState = 'code';
          importQuote = null;
        }
        j += 1;
        continue;
      } else if (importState === 'template') {
        if (cj === '`') {
          importState = 'code';
          importQuote = null;
        } else if (cj === '\\') {
          j += 2;
          continue;
        }
        j += 1;
        continue;
      }
      j += 1;
    }

    const importText = sourceText.slice(importStart, j);
    return {
      found: true,
      nextPos: j,
      statement: { start: importStart, end: j, text: importText },
    };
  }

  return { found: false, nextPos: pos };
}

/**
 * Parse import and export-from statements from JavaScript/TypeScript/CSS code.
 *
 * This function analyzes source code to extract all import and export-from statements,
 * categorizing them as either relative imports (local files) or external imports (packages).
 * It supports JavaScript, TypeScript, CSS, and MDX files.
 *
 * Comment processing (stripping/collecting) is performed during import parsing
 * for efficiency. Since we must already parse the entire file character-by-character
 * to correctly identify imports while avoiding false positives in strings, comments,
 * and template literals, it's most efficient to handle comment processing in this
 * same pass rather than requiring separate parsing steps.
 *
 * The function accepts file:// URLs or file paths and converts them internally to a
 * portable path format that works cross-platform. Resolved import paths are returned
 * in the same portable format (forward slashes, starting with /).
 *
 * @param code - The source code to parse
 * @param fileUrl - The file URL (file:// protocol) or path, used to determine file type and resolve relative imports
 * @param options - Optional configuration for comment processing
 * @param options.removeCommentsWithPrefix - Array of prefixes; comments starting with these will be stripped from output
 * @param options.notableCommentsPrefix - Array of prefixes; comments starting with these will be collected regardless of stripping
 * @returns Promise resolving to parsed import data, optionally including processed code and collected comments
 *
 * @example
 * ```typescript
 * const result = await parseImportsAndComments(
 *   'import React from "react";\nimport { Button } from "./Button";\nexport { Icon } from "./Icon";',
 *   '/src/App.tsx'
 * );
 * // result.externals['react'] contains the React import
 * // result.relative['./Button'] contains the Button import
 * // result.relative['./Icon'] contains the Icon re-export
 * ```
 */
export async function parseImportsAndComments(
  code: string,
  fileUrl: string,
  options?: { removeCommentsWithPrefix?: string[]; notableCommentsPrefix?: string[] },
): Promise<ImportsAndComments> {
  const result: Record<string, RelativeImport> = {};
  const externals: Record<string, ExternalImport> = {};

  // Convert file:// URL or OS path to portable path format for cross-platform compatibility
  // Portable paths always use forward slashes and start with / (even on Windows: /C:/...)
  const filePath = fileUrlToPortablePath(fileUrl);

  // Check if this is a CSS file
  const isCssFile = filePath.toLowerCase().endsWith('.css');

  // Check if this is an MDX file (which can contain code blocks with triple backticks)
  const isMdxFile = filePath.toLowerCase().endsWith('.mdx');

  // If this is a CSS file, parse CSS @import statements instead
  if (isCssFile) {
    return parseCssImports(
      code,
      filePath,
      result,
      externals,
      options?.removeCommentsWithPrefix,
      options?.notableCommentsPrefix,
    );
  }

  // Parse JavaScript import and export-from statements
  return parseJSImports(
    code,
    filePath,
    result,
    externals,
    isMdxFile,
    options?.removeCommentsWithPrefix,
    options?.notableCommentsPrefix,
  );
}
