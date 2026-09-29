import * as path from 'path-module';
import { fileUrlToPortablePath, portablePathToFileUrl } from './fileUrlToPortablePath';
import { findJavascriptImportEnd, parseJavascriptImports } from './parseJavascriptImports';

/**
 * Resolves a relative import path against the URL/path of the importing file.
 *
 * - For `http://` and `https://` files, uses WHATWG `URL` resolution so that
 *   demos can be parsed straight out of remote sources (e.g. GitHub) without
 *   first being mapped onto a placeholder `file://` URL.
 * - For everything else, falls back to POSIX `path.resolve` against the
 *   portable path form, which preserves the existing cross-platform behavior
 *   for local files.
 */
function resolveRelativeImport(baseFilePath: string, modulePath: string): string {
  if (baseFilePath.startsWith('http://') || baseFilePath.startsWith('https://')) {
    return new URL(modulePath, baseFilePath).href;
  }
  return portablePathToFileUrl(path.resolve(path.dirname(baseFilePath), modulePath));
}

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
  /**
   * Map of 1-indexed output line numbers (in `code`, after comment removal) to arrays of
   * comment content (if comment processing was requested). 1-indexed is the canonical
   * `Code` convention, matching the HAST `dataLn` gutter the enhancers read.
   */
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
    'code' | 'singleline-comment' | 'multiline-comment' | 'string' | 'template' | 'codeblock' =
    'code';
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
          // Count newlines in multi-line imports to keep outputLine accurate
          for (let j = 0; j < importText.length; j += 1) {
            if (importText[j] === '\n') {
              outputLine += 1;
              lineStartPos = i + j + 1;
            }
          }
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
            // Record the comment 1-indexed: `Code` comments are always 1-indexed (the
            // convention the enhancers match against the `dataLn` line gutter). `outputLine`
            // is tracked 0-indexed internally, so add one at the point of storage.
            const commentLine = commentStartOutputLine + 1;
            if (!comments[commentLine]) {
              comments[commentLine] = [];
            }
            comments[commentLine].push(...stripCommentMarkers(commentText));
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
            // Record the comment 1-indexed: `Code` comments are always 1-indexed (the
            // convention the enhancers match against the `dataLn` line gutter). `outputLine`
            // is tracked 0-indexed internally, so add one at the point of storage.
            const commentLine = commentStartOutputLine + 1;
            if (!comments[commentLine]) {
              comments[commentLine] = [];
            }
            comments[commentLine].push(...stripCommentMarkers(commentText));
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
      // Record 1-indexed (the `Code` convention); see the other recording sites above.
      const commentLine = commentStartOutputLine + 1;
      if (!comments[commentLine]) {
        comments[commentLine] = [];
      }
      comments[commentLine].push(...stripCommentMarkers(commentText));
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

/**
 * Records one CSS import path into the relative or external bucket, with its
 * source position for rewriting. Shared by `@import`, `composes ... from`, and
 * `@value ... from`. In CSS a path is relative unless it has a protocol,
 * hostname, or scoped-package (`@scope/`) prefix.
 */
function recordCssImport(
  modulePath: string,
  pathStart: number,
  pathEnd: number,
  cssResult: Record<string, RelativeImport>,
  cssExternals: Record<string, ExternalImport>,
  cssFilePath: string,
  positionMapper: (originalPos: number) => number,
): void {
  const hasProtocol = /^https?:\/\//.test(modulePath);
  const hasHostname = /^\/\//.test(modulePath);
  const isScopedPackage = /^@[^/]+\//.test(modulePath);
  const isRelative = !hasProtocol && !hasHostname && !isScopedPackage;

  const position: ImportPathPosition = {
    start: positionMapper(pathStart),
    end: positionMapper(pathEnd),
  };

  if (isRelative) {
    // Normalize bare filenames (e.g. "reset.css") to relative paths.
    let normalizedPath = modulePath;
    if (!normalizedPath.startsWith('./') && !normalizedPath.startsWith('../')) {
      normalizedPath = `./${normalizedPath}`;
    }
    if (!cssResult[modulePath]) {
      cssResult[modulePath] = {
        url: resolveRelativeImport(cssFilePath, normalizedPath),
        names: [],
        positions: [],
      };
    }
    cssResult[modulePath].positions.push(position);
  } else {
    if (!cssExternals[modulePath]) {
      cssExternals[modulePath] = { names: [], positions: [] };
    }
    cssExternals[modulePath].positions.push(position);
  }
}

/** Index of the `;` or `}` ending a CSS statement at/after `start` (string-aware). */
function findCssStatementEnd(text: string, start: number): number {
  let pos = start;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === ';' || ch === '}') {
      return pos;
    }
    if (ch === '"' || ch === "'") {
      pos += 1;
      while (pos < text.length && text[pos] !== ch) {
        pos += text[pos] === '\\' ? 2 : 1;
      }
    }
    pos += 1;
  }
  return text.length;
}

/**
 * Scans a `composes`/`@value` statement body (`[start, end)`) for a
 * `from "<path>"` clause, skipping any quoted string before it. Returns the
 * quoted module path with its position (quotes included), or null for a same-file
 * `composes`, a `from global`, or a plain `@value` definition.
 */
function parseCssFromClause(
  text: string,
  start: number,
  end: number,
): { modulePath: string; pathStart: number; pathEnd: number } | null {
  let pos = start;
  while (pos < end) {
    const ch = text[pos];
    // Skip a quoted string (e.g. a `@value` definition's string value).
    if (ch === '"' || ch === "'") {
      pos += 1;
      while (pos < end && text[pos] !== ch) {
        pos += text[pos] === '\\' ? 2 : 1;
      }
      pos += 1;
      continue;
    }
    // A standalone `from` keyword introduces the source module.
    if (
      ch === 'f' &&
      text.slice(pos, pos + 4) === 'from' &&
      !isIdentifierChar(text[pos - 1] || '') &&
      !isIdentifierChar(text[pos + 4] || '')
    ) {
      const quoteStart = skipWhitespace(text, pos + 4);
      const quote = text[quoteStart];
      if (quote !== '"' && quote !== "'") {
        return null; // `from global` or other non-path source
      }
      let cursor = quoteStart + 1;
      let modulePath = '';
      while (cursor < end && text[cursor] !== quote) {
        if (text[cursor] === '\\' && cursor + 1 < end) {
          // Keep the escaped character (drop the backslash): `\"` denotes a literal
          // quote in the specifier, so it must stay in the path, not be lost.
          modulePath += text[cursor + 1];
          cursor += 2;
          continue;
        }
        modulePath += text[cursor];
        cursor += 1;
      }
      if (text[cursor] !== quote) {
        return null; // unterminated
      }
      return { modulePath, pathStart: quoteStart, pathEnd: cursor + 1 };
    }
    pos += 1;
  }
  return null;
}

/** Whether `pos` begins a CSS declaration (a property), not a selector or value. */
function atCssDeclarationStart(text: string, pos: number): boolean {
  let index = pos - 1;
  while (index >= 0 && isWhitespace(text[index])) {
    index -= 1;
  }
  if (index < 0) {
    return true;
  }
  const ch = text[index];
  return ch === '{' || ch === ';' || ch === '}';
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
      recordCssImport(
        importResult.modulePath,
        importResult.pathStart,
        importResult.pathEnd,
        cssResult,
        cssExternals,
        cssFilePath,
        positionMapper,
      );
    }
    return { found: true, nextPos: importResult.nextPos };
  }

  // Look for `@value <names> from "<path>"` — a cross-file CSS-module value import
  // (a plain `@value name: value;` definition has no `from` and is left alone).
  if (
    ch === '@' &&
    sourceText.slice(pos, pos + 6) === '@value' &&
    isWhitespace(sourceText[pos + 6] || '')
  ) {
    const stop = findCssStatementEnd(sourceText, pos + 6);
    const fromClause = parseCssFromClause(sourceText, pos + 6, stop);
    if (fromClause) {
      recordCssImport(
        fromClause.modulePath,
        fromClause.pathStart,
        fromClause.pathEnd,
        cssResult,
        cssExternals,
        cssFilePath,
        positionMapper,
      );
      return { found: true, nextPos: stop };
    }
    return { found: false, nextPos: pos };
  }

  // Look for `composes: <names> from "<path>"` — a cross-file CSS-module
  // composition (a same-file `composes: a b;` or `from global` is left alone).
  if (
    ch === 'c' &&
    sourceText.slice(pos, pos + 8) === 'composes' &&
    !isIdentifierChar(sourceText[pos + 8] || '') &&
    atCssDeclarationStart(sourceText, pos)
  ) {
    const colon = skipWhitespace(sourceText, pos + 8);
    if (sourceText[colon] === ':') {
      const stop = findCssStatementEnd(sourceText, colon + 1);
      const fromClause = parseCssFromClause(sourceText, colon + 1, stop);
      if (fromClause) {
        recordCssImport(
          fromClause.modulePath,
          fromClause.pathStart,
          fromClause.pathEnd,
          cssResult,
          cssExternals,
          cssFilePath,
          positionMapper,
        );
        return { found: true, nextPos: stop };
      }
    }
    return { found: false, nextPos: pos };
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

/** Parses JavaScript/TypeScript imports while retaining the existing MDX/comment handling. */
function parseJSImports(
  code: string,
  filePath: string,
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  isMdxFile: boolean,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments {
  const shouldScan = Boolean(isMdxFile || removeCommentsWithPrefix || notableCommentsPrefix);
  const scanResult = shouldScan
    ? scanForImports(
        code,
        isMdxFile
          ? detectJavaScriptImport
          : (_source, position) => ({ found: false, nextPos: position }),
        isMdxFile,
        removeCommentsWithPrefix,
        notableCommentsPrefix,
      )
    : { statements: [] };
  const resolveImport = (modulePath: string) => resolveRelativeImport(filePath, modulePath);

  if (isMdxFile) {
    for (const statement of scanResult.statements) {
      parseJavascriptImports(statement.text, {
        sourceName: filePath,
        sourceOffset: statement.start,
        mapPosition: scanResult.positionMapper,
        resolveRelativeImport: resolveImport,
        relative: result,
        externals,
      });
    }
  } else {
    parseJavascriptImports(scanResult.code ?? code, {
      sourceName: filePath,
      resolveRelativeImport: resolveImport,
      relative: result,
      externals,
    });
  }

  return {
    relative: result,
    externals,
    ...(scanResult.code && { code: scanResult.code }),
    ...(scanResult.comments && { comments: scanResult.comments }),
  };
}

/** Detects one JavaScript module reference in an MDX JavaScript region. */
function detectJavaScriptImport(
  sourceText: string,
  position: number,
  _positionMapper: (originalPosition: number) => number,
) {
  const isImport = sourceText.startsWith('import', position);
  const isExport = sourceText.startsWith('export', position);
  const keywordLength = 6;
  const previous = sourceText[position - 1] ?? '';
  const next = sourceText[position + keywordLength] ?? '';
  if ((!isImport && !isExport) || /[a-zA-Z0-9_$@.]/.test(previous) || /[a-zA-Z0-9_$]/.test(next)) {
    return { found: false, nextPos: position };
  }
  const end = findJavascriptImportEnd(sourceText, position);
  if (end === null) {
    return { found: false, nextPos: position };
  }
  return {
    found: true,
    nextPos: end,
    statement: { start: position, end, text: sourceText.slice(position, end) },
  };
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
 * The function accepts file:// URLs, http(s):// URLs, or file paths. File URLs
 * and OS paths are normalized to a portable POSIX-style path internally and
 * resolved via `path.resolve`. http(s):// URLs are preserved verbatim and
 * relative imports are resolved via WHATWG `URL`, which means demos can be
 * parsed straight out of remote sources without first being mapped onto a
 * placeholder `file://` URL.
 *
 * Parsing is fully synchronous — no I/O, no `await`.
 *
 * @param code - The source code to parse
 * @param fileUrl - The file URL (`file://`, `http://`, `https://`) or path, used to determine file type and resolve relative imports
 * @param options - Optional configuration for comment processing
 * @param options.removeCommentsWithPrefix - Array of prefixes; comments starting with these will be stripped from output
 * @param options.notableCommentsPrefix - Array of prefixes; comments starting with these will be collected regardless of stripping
 * @returns Parsed import data, optionally including processed code and collected comments
 *
 * @example
 * ```typescript
 * const result = parseImportsAndComments(
 *   'import React from "react";\nimport { Button } from "./Button";\nexport { Icon } from "./Icon";',
 *   '/src/App.tsx'
 * );
 * // result.externals['react'] contains the React import
 * // result.relative['./Button'] contains the Button import
 * // result.relative['./Icon'] contains the Icon re-export
 * ```
 */
export function parseImportsAndComments(
  code: string,
  fileUrl: string,
  options?: { removeCommentsWithPrefix?: string[]; notableCommentsPrefix?: string[] },
): ImportsAndComments {
  const result: Record<string, RelativeImport> = {};
  const externals: Record<string, ExternalImport> = {};

  // For http(s) URLs, keep the URL as-is so relative imports resolve via WHATWG
  // `URL`. For file:// URLs and OS paths, convert to a portable POSIX-style path
  // for cross-platform compatibility (forward slashes, leading `/` even on Windows).
  const isHttpUrl = fileUrl.startsWith('http://') || fileUrl.startsWith('https://');
  const filePath = isHttpUrl ? fileUrl : fileUrlToPortablePath(fileUrl);

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
