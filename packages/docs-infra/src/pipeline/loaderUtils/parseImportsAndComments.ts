import * as path from 'path-module';
import { parseSync } from 'oxc-parser';
import type {
  Comment,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ImportExpression,
} from 'oxc-parser';
import { fileUrlToPortablePath, portablePathToFileUrl } from './fileUrlToPortablePath';

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
 */
function isIdentifierChar(ch: string): boolean {
  return /[a-zA-Z0-9_$]/.test(ch);
}

/**
 * Checks if a character is whitespace.
 */
function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Skips whitespace characters and returns the next non-whitespace position.
 */
function skipWhitespace(text: string, start: number): number {
  let pos = start;
  while (pos < text.length && isWhitespace(text[pos])) {
    pos += 1;
  }
  return pos;
}

/** A module reference found in source code, normalized for recording. */
interface FoundModuleReference {
  /** Full span of the owning statement/expression (comments inside are left untouched). */
  start: number;
  end: number;
  /** The import specifier value with escapes resolved. */
  modulePath: string;
  /** Position of the specifier in the source, including quotes. */
  pathStart: number;
  pathEnd: number;
  /** Whether the statement is a top-level `import type`/`export type`. */
  isTypeStatement: boolean;
  /** Whether the statement has a `from` clause (or is an export-from). */
  hasFromClause?: boolean;
  names: Array<{
    name: string;
    alias?: string;
    type: 'default' | 'named' | 'namespace';
    isType?: boolean;
  }>;
}

/**
 * Recursively collect dynamic `import(...)` expressions in an AST subtree.
 */
function collectImportExpressions(node: unknown, found: ImportExpression[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectImportExpressions(item, found);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type !== 'string') {
    return;
  }
  if (record.type === 'ImportExpression') {
    found.push(node as ImportExpression);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'type' && typeof value === 'object') {
      collectImportExpressions(value, found);
    }
  }
}

/** Whether the `as` keyword was written, i.e. the two identifier spans differ. */
function hasAlias(a: { start: number }, b: { start: number }): boolean {
  return a.start !== b.start;
}

/** Read the name of an imported/exported binding (identifier or string literal). */
function moduleBindingName(node: { type: string; name?: string; value?: unknown }): string {
  return node.type === 'Identifier' && node.name !== undefined ? node.name : String(node.value);
}

/**
 * Convert a static import/export-from AST statement into a module reference,
 * or return null when the statement doesn't reference a module.
 */
function moduleReferenceFromStatement(
  statement: { type: string },
  code: string,
  offset = 0,
): FoundModuleReference | null {
  if (statement.type === 'ImportDeclaration') {
    const declaration = statement as ImportDeclaration;
    const names: FoundModuleReference['names'] = [];
    for (const specifier of declaration.specifiers ?? []) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        names.push({ name: specifier.local.name, type: 'default' });
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        names.push({ name: specifier.local.name, type: 'namespace' });
      } else {
        names.push({
          name: moduleBindingName(specifier.imported),
          ...(hasAlias(specifier.imported, specifier.local) && { alias: specifier.local.name }),
          type: 'named',
          ...(specifier.importKind === 'type' && { isType: true }),
        });
      }
    }
    const importKeywordEnd = declaration.start + offset + 6;
    return {
      start: declaration.start + offset,
      end: declaration.end + offset,
      modulePath: declaration.source.value,
      pathStart: declaration.source.start + offset,
      pathEnd: declaration.source.end + offset,
      isTypeStatement: declaration.importKind === 'type',
      // A side-effect import (`import './x'`) has no clause after the keyword.
      hasFromClause: code.slice(importKeywordEnd, declaration.source.start + offset).trim() !== '',
      names,
    };
  }

  if (statement.type === 'ExportNamedDeclaration') {
    const declaration = statement as ExportNamedDeclaration;
    if (!declaration.source) {
      return null;
    }
    const names: FoundModuleReference['names'] = [];
    for (const specifier of declaration.specifiers ?? []) {
      names.push({
        name: moduleBindingName(specifier.local),
        ...(hasAlias(specifier.local, specifier.exported) && {
          alias: moduleBindingName(specifier.exported),
        }),
        type: 'named',
        ...(specifier.exportKind === 'type' && { isType: true }),
      });
    }
    return {
      start: declaration.start + offset,
      end: declaration.end + offset,
      modulePath: declaration.source.value,
      pathStart: declaration.source.start + offset,
      pathEnd: declaration.source.end + offset,
      isTypeStatement: declaration.exportKind === 'type',
      hasFromClause: true,
      names,
    };
  }

  if (statement.type === 'ExportAllDeclaration') {
    const declaration = statement as ExportAllDeclaration;
    return {
      start: declaration.start + offset,
      end: declaration.end + offset,
      modulePath: declaration.source.value,
      pathStart: declaration.source.start + offset,
      pathEnd: declaration.source.end + offset,
      isTypeStatement: declaration.exportKind === 'type',
      hasFromClause: true,
      names: declaration.exported
        ? [{ name: moduleBindingName(declaration.exported), type: 'namespace' }]
        : [],
    };
  }

  return null;
}

/**
 * A from-clause statement that isn't terminated by a semicolon extends (its
 * statement text runs on) until the next top-level `;`, hiding any imports
 * inside that region.
 */
function applyUnterminatedStatementRule(
  references: FoundModuleReference[],
  code: string,
): FoundModuleReference[] {
  const kept: FoundModuleReference[] = [];
  let swallowUntil = -1;

  for (const reference of references) {
    if (reference.start < swallowUntil) {
      continue;
    }
    kept.push(reference);
    if (!reference.hasFromClause) {
      continue;
    }

    let pos = skipWhitespace(code, reference.pathEnd);
    if (pos >= code.length || code[pos] === ';') {
      continue; // Properly terminated.
    }
    // Unterminated: the statement swallows everything up to the next `;`
    // outside of a string or template literal.
    let quote: string | null = null;
    while (pos < code.length) {
      const ch = code[pos];
      if (quote) {
        if (ch === '\\') {
          pos += 1;
        } else if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === ';') {
        break;
      }
      pos += 1;
    }
    swallowUntil = pos + 1;
    // The swallowed text is part of the statement; shield its comments too.
    reference.end = Math.max(reference.end, Math.min(swallowUntil, code.length));
  }

  return kept;
}

/**
 * Extract all static imports, re-exports, and literal dynamic imports from an
 * oxc program, in source order. Non-literal dynamic imports are included with an
 * empty `modulePath` so their spans still shield inner comments from processing.
 */
function collectModuleReferences(
  program: { body: unknown[] },
  code: string,
): FoundModuleReference[] {
  const references: FoundModuleReference[] = [];

  for (const statement of program.body as Array<{ type: string }>) {
    const reference = moduleReferenceFromStatement(statement, code);
    if (reference) {
      references.push(reference);
    }
  }

  const dynamicImports: ImportExpression[] = [];
  collectImportExpressions(program.body, dynamicImports);
  for (const expression of dynamicImports) {
    const source = expression.source as {
      type: string;
      value?: unknown;
      start: number;
      end: number;
    };
    const isLiteral = source.type === 'Literal' && typeof source.value === 'string';
    references.push({
      start: expression.start,
      end: expression.end,
      // Non-literal specifiers can't be resolved statically; keep the span only.
      modulePath: isLiteral ? (source.value as string) : '',
      pathStart: source.start,
      pathEnd: source.end,
      isTypeStatement: false,
      names: [],
    });
  }

  return applyUnterminatedStatementRule(
    references.sort((a, b) => a.start - b.start),
    code,
  );
}

/**
 * Record a module reference into the relative or external bucket.
 */
function recordModuleReference(
  reference: FoundModuleReference,
  filePath: string,
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  mapPosition: (originalPos: number) => number,
): void {
  const { modulePath } = reference;
  const position: ImportPathPosition = {
    start: mapPosition(reference.pathStart),
    end: mapPosition(reference.pathEnd),
  };

  const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');
  if (isRelative) {
    if (!result[modulePath]) {
      result[modulePath] = {
        url: resolveRelativeImport(filePath, modulePath),
        names: [],
        positions: [],
        ...(reference.isTypeStatement && { includeTypeDefs: true as const }),
      };
    } else if (reference.isTypeStatement && !result[modulePath].includeTypeDefs) {
      result[modulePath].includeTypeDefs = true;
    }
  } else if (!externals[modulePath]) {
    externals[modulePath] = { names: [], positions: [] };
  }

  const target = isRelative ? result[modulePath] : externals[modulePath];
  target.positions.push(position);
  reference.names.forEach(({ name, alias, type, isType }) => {
    addImportName(target.names, name, type, alias, reference.isTypeStatement || isType);
  });
}

/**
 * Collect `// ...` line pseudo-comments inside JSX text. JSX has no `//` comment
 * syntax, but demo authors write emphasis directives that way between JSX
 * children, and this pipeline keeps supporting that authoring convention.
 */
function collectJsxTextComments(node: unknown, code: string, found: Comment[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsxTextComments(item, code, found);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type !== 'string') {
    return;
  }
  if (record.type === 'JSXText') {
    const text = node as { start: number; end: number; value: string };
    let searchFrom = text.start;
    while (searchFrom < text.end) {
      const commentStart = code.indexOf('//', searchFrom);
      if (commentStart === -1 || commentStart >= text.end) {
        break;
      }
      // The pseudo-comment runs to the end of the source line, like a real one.
      let commentEnd = code.indexOf('\n', commentStart);
      if (commentEnd === -1) {
        commentEnd = code.length;
      }
      found.push({
        type: 'Line',
        value: code.slice(commentStart + 2, commentEnd),
        start: commentStart,
        end: commentEnd,
      });
      searchFrom = commentEnd;
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'type' && typeof value === 'object') {
      collectJsxTextComments(value, code, found);
    }
  }
}

/** A pending text removal from the source code. */
interface RemovalEdit {
  start: number;
  end: number;
}

/**
 * Process comments from their source spans: comment-only lines are removed
 * entirely (including JSX `{/* ... *\/}` wrappers), inline comments are removed
 * with trailing whitespace trimmed, and collected comments are recorded against
 * their 1-indexed line in the output code.
 */
function processCommentSpans(
  code: string,
  comments: Comment[],
  excludedRanges: Array<{ start: number; end: number }>,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): {
  code?: string;
  comments?: Record<number, string[]>;
  mapPosition: (originalPos: number) => number;
} {
  const matchesPrefix = (comment: Comment, prefixes: string[]): boolean =>
    prefixes.some((prefix) => comment.value.trim().startsWith(prefix));

  const commentLines = (comment: Comment): string[] =>
    comment.type === 'Line'
      ? [comment.value.trim()]
      : comment.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '');

  const collected: Record<number, string[]> = {};
  const edits: RemovalEdit[] = [];
  let removedNewlines = 0;
  let anyCommentStripped = false;

  const countNewlines = (text: string): number => text.split('\n').length - 1;

  for (const comment of comments) {
    const isExcluded = excludedRanges.some(
      (range) => comment.start >= range.start && comment.end <= range.end,
    );
    if (isExcluded) {
      continue;
    }

    const shouldStrip = Boolean(
      removeCommentsWithPrefix && matchesPrefix(comment, removeCommentsWithPrefix),
    );
    const isNotable = Boolean(
      notableCommentsPrefix?.length && matchesPrefix(comment, notableCommentsPrefix),
    );
    const shouldCollect = (shouldStrip && !notableCommentsPrefix) || isNotable;

    if (shouldCollect) {
      // 1-indexed line in the OUTPUT code (after removals so far).
      const line = countNewlines(code.slice(0, comment.start)) - removedNewlines + 1;
      if (!collected[line]) {
        collected[line] = [];
      }
      collected[line].push(...commentLines(comment));
    }

    if (!shouldStrip) {
      continue;
    }
    anyCommentStripped = true;

    const lineStart = code.lastIndexOf('\n', comment.start - 1) + 1;
    const preComment = code.slice(lineStart, comment.start);
    let edit: RemovalEdit;

    if (comment.type === 'Line') {
      if (comment.end >= code.length) {
        // Comment runs to EOF with no newline: the whole line is dropped,
        // including any code before the comment.
        edit = { start: lineStart, end: code.length };
      } else if (preComment.trim() === '') {
        // Comment-only line: remove the whole line including its newline.
        edit = {
          start: lineStart,
          end: code[comment.end] === '\n' ? comment.end + 1 : comment.end,
        };
      } else {
        // Inline: keep the code with trailing whitespace trimmed, keep the newline.
        edit = { start: lineStart + preComment.trimEnd().length, end: comment.end };
      }
    } else {
      let nextNewline = code.indexOf('\n', comment.end);
      if (nextNewline === -1) {
        nextNewline = code.length;
      }
      const afterComment = code.slice(comment.end, nextNewline);

      // JSX comment syntax: `{/* ... */}` — the braces are stripped with it.
      const trimmedPre = preComment.trimEnd();
      const trimmedAfter = afterComment.trimStart();
      const isJsxComment = trimmedPre.endsWith('{') && trimmedAfter.startsWith('}');
      const preWithoutBrace = isJsxComment ? trimmedPre.slice(0, -1) : preComment;
      const afterWithoutBrace = isJsxComment ? trimmedAfter.slice(1) : afterComment;

      if (preWithoutBrace.trim() === '' && afterWithoutBrace.trim() === '') {
        // Nothing else on the comment's lines: remove them entirely.
        edit = { start: lineStart, end: Math.min(nextNewline + 1, code.length) };
      } else if (isJsxComment) {
        // Inline JSX comment: strip through the closing brace.
        let braceEnd = comment.end;
        while (braceEnd < nextNewline && /\s/.test(code[braceEnd])) {
          braceEnd += 1;
        }
        if (code[braceEnd] === '}') {
          braceEnd += 1;
        }
        edit = { start: lineStart + preWithoutBrace.trimEnd().length, end: braceEnd };
      } else {
        // Inline block comment: keep surrounding code, trim before the comment.
        edit = { start: lineStart + preComment.trimEnd().length, end: comment.end };
      }
    }

    edits.push(edit);
    removedNewlines += countNewlines(code.slice(edit.start, edit.end));
  }

  // Merge overlapping edits (multiple stripped comments on one line).
  const merged: RemovalEdit[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && edit.start <= last.end) {
      last.end = Math.max(last.end, edit.end);
    } else {
      merged.push({ ...edit });
    }
  }

  const mapPosition = (originalPos: number): number => {
    let removed = 0;
    for (const edit of merged) {
      if (edit.end <= originalPos) {
        removed += edit.end - edit.start;
      } else if (edit.start < originalPos) {
        removed += originalPos - edit.start;
      }
    }
    return originalPos - removed;
  };

  if (!anyCommentStripped) {
    return {
      mapPosition,
      ...(notableCommentsPrefix &&
        Object.keys(collected).length > 0 && {
          comments: collected,
        }),
    };
  }

  let strippedCode = '';
  let cursor = 0;
  for (const edit of merged) {
    strippedCode += code.slice(cursor, edit.start);
    cursor = edit.end;
  }
  strippedCode += code.slice(cursor);

  return {
    code: strippedCode,
    ...(Object.keys(collected).length > 0 && { comments: collected }),
    mapPosition,
  };
}

/**
 * Assemble the public result from found references and processed comments.
 */
function buildResult(
  filePath: string,
  references: FoundModuleReference[],
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  commentResult?: ReturnType<typeof processCommentSpans>,
): ImportsAndComments {
  // Positions are only remapped when stripping actually changed the code.
  const mapPosition =
    commentResult?.code !== undefined
      ? commentResult.mapPosition
      : (originalPos: number) => originalPos;

  for (const reference of references) {
    if (reference.modulePath) {
      recordModuleReference(reference, filePath, result, externals, mapPosition);
    }
  }

  return {
    relative: result,
    externals,
    // An empty stripped result is omitted so callers keep the original source.
    ...(commentResult?.code && { code: commentResult.code }),
    ...(commentResult?.comments && { comments: commentResult.comments }),
  };
}

/**
 * Parse a JavaScript/TypeScript file with oxc, extracting imports and processing
 * comments from the AST. Returns null when the file doesn't parse cleanly so the
 * caller can fall back to the lenient extraction.
 */
function parseJsImports(
  code: string,
  filePath: string,
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments | null {
  const filename = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(filePath) ? filePath : 'file.tsx';
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(filename, code);
  } catch {
    return null;
  }
  if (parsed.errors.length > 0) {
    return null;
  }

  const references = collectModuleReferences(parsed.program, code);

  const shouldProcessComments = Boolean(removeCommentsWithPrefix || notableCommentsPrefix);
  let commentResult: ReturnType<typeof processCommentSpans> | undefined;
  if (shouldProcessComments) {
    const jsxTextComments: Comment[] = [];
    collectJsxTextComments(parsed.program.body, code, jsxTextComments);
    const allComments = jsxTextComments.length
      ? [...parsed.comments, ...jsxTextComments].sort((a, b) => a.start - b.start)
      : parsed.comments;
    commentResult = processCommentSpans(
      code,
      allComments,
      references,
      removeCommentsWithPrefix,
      notableCommentsPrefix,
    );
  }

  return buildResult(filePath, references, result, externals, commentResult);
}

/**
 * Mask the regions of a file where import statements can't start — string and
 * template literal contents (JS), inline code and fenced code blocks (MDX) —
 * and collect comment spans along the way. The mask is position-preserving:
 * masked characters become spaces, newlines are kept.
 */
function maskSource(code: string, isMdxFile: boolean): { masked: string; comments: Comment[] } {
  const masked = code.split('');
  const comments: Comment[] = [];
  const len = code.length;

  const mask = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      if (masked[index] !== '\n') {
        masked[index] = ' ';
      }
    }
  };

  let i = 0;
  while (i < len) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      let end = code.indexOf('\n', i);
      if (end === -1) {
        end = len;
      }
      comments.push({ type: 'Line', value: code.slice(i + 2, end), start: i, end });
      mask(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      const end = close === -1 ? len : close + 2;
      comments.push({
        type: 'Block',
        value: code.slice(i + 2, close === -1 ? len : close),
        start: i,
        end,
      });
      mask(i, end);
      i = end;
      continue;
    }

    if (isMdxFile) {
      if (ch === '`') {
        let backticks = 0;
        while (code[i + backticks] === '`') {
          backticks += 1;
        }
        if (backticks >= 3) {
          // Fenced code block: masked until a closing run of at least as many backticks.
          const close = code.indexOf('`'.repeat(backticks), i + backticks);
          let end = len;
          if (close !== -1) {
            end = close;
            while (code[end] === '`') {
              end += 1;
            }
          }
          mask(i, end);
          i = end;
          continue;
        }
        // Inline code span: masked until the next backtick.
        const close = code.indexOf('`', i + 1);
        const end = close === -1 ? len : close + 1;
        mask(i, end);
        i = end;
        continue;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let end = i + 1;
      while (end < len) {
        if (code[end] === '\\') {
          end += 2;
          continue;
        }
        if (code[end] === ch) {
          end += 1;
          break;
        }
        end += 1;
      }
      end = Math.min(end, len);
      mask(i + 1, Math.max(end - 1, i + 1));
      i = end;
      continue;
    }

    i += 1;
  }

  return { masked: masked.join(''), comments };
}

/** Maximum lines a lenient candidate statement may span. */
const MAX_CANDIDATE_LINES = 20;

/**
 * Try to parse a single import/export-from statement starting at `pos` by
 * feeding oxc progressively longer line-bounded slices until one parses cleanly.
 */
function parseCandidateStatement(code: string, pos: number): FoundModuleReference | null {
  let sliceEnd = pos;
  for (let lines = 0; lines < MAX_CANDIDATE_LINES; lines += 1) {
    const nextNewline = code.indexOf('\n', sliceEnd + 1);
    sliceEnd = nextNewline === -1 ? code.length : nextNewline;

    const candidate = code.slice(pos, sliceEnd);
    const parsed = parseSync('candidate.tsx', candidate);
    if (parsed.errors.length === 0 && parsed.program.body.length >= 1) {
      const reference = moduleReferenceFromStatement(
        parsed.program.body[0] as { type: string },
        code,
        pos,
      );
      // Only accept when the statement starts exactly at the keyword.
      if (reference && reference.start === pos) {
        return reference;
      }
      return null;
    }

    if (nextNewline === -1) {
      break;
    }
  }
  return null;
}

/**
 * Lenient import extraction for MDX files (imports interleaved with markdown)
 * and JS files that don't parse cleanly. Masks regions where statements can't
 * start, then tries to parse a statement at each `import`/`export` keyword.
 */
function parseImportsLeniently(
  code: string,
  filePath: string,
  isMdxFile: boolean,
  result: Record<string, RelativeImport>,
  externals: Record<string, ExternalImport>,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments {
  const { masked, comments } = maskSource(code, isMdxFile);
  const references: FoundModuleReference[] = [];

  const keywordRegex = /\b(import|export)\b/g;
  let scanFloor = 0;
  let match = keywordRegex.exec(masked);
  while (match !== null) {
    const pos = match.index;
    if (pos >= scanFloor) {
      const previous = code[pos - 1] ?? '';
      // `obj.import(...)`, `@import`, or a decorator is not a statement start.
      const validStart =
        match[1] === 'import' ? !/[a-zA-Z0-9_$@.]/.test(previous) : !isIdentifierChar(previous);
      if (validStart) {
        const reference = parseCandidateStatement(code, pos);
        if (reference) {
          references.push(reference);
          scanFloor = reference.end;
        }
      }
    }
    match = keywordRegex.exec(masked);
  }

  const shouldProcessComments = Boolean(removeCommentsWithPrefix || notableCommentsPrefix);
  const commentResult = shouldProcessComments
    ? processCommentSpans(
        code,
        comments,
        references,
        removeCommentsWithPrefix,
        notableCommentsPrefix,
      )
    : undefined;

  return buildResult(filePath, references, result, externals, commentResult);
}

/** A raw CSS import found during scanning, before position mapping. */
interface CssImportMatch {
  modulePath: string;
  pathStart: number;
  pathEnd: number;
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
  cssImport: CssImportMatch,
  cssResult: Record<string, RelativeImport>,
  cssExternals: Record<string, ExternalImport>,
  cssFilePath: string,
  positionMapper: (originalPos: number) => number,
): void {
  const { modulePath, pathStart, pathEnd } = cssImport;
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
function parseCssFromClause(text: string, start: number, end: number): CssImportMatch | null {
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

/**
 * Detects a CSS import construct (`@import`, `@value ... from`, `composes ... from`)
 * at the given position. Returns the matched import (when resolvable) and the
 * position where scanning should resume.
 */
function detectCssImport(
  sourceText: string,
  pos: number,
): { found: boolean; nextPos: number; cssImport?: CssImportMatch } {
  const ch = sourceText[pos];

  // Look for '@import' keyword
  if (
    ch === '@' &&
    sourceText.slice(pos, pos + 7) === '@import' &&
    /\s/.test(sourceText[pos + 7] || '')
  ) {
    const importResult = parseCssImportStatement(sourceText, pos);
    if (
      importResult.modulePath &&
      importResult.pathStart !== undefined &&
      importResult.pathEnd !== undefined
    ) {
      return {
        found: true,
        nextPos: importResult.nextPos,
        cssImport: {
          modulePath: importResult.modulePath,
          pathStart: importResult.pathStart,
          pathEnd: importResult.pathEnd,
        },
      };
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
      return { found: true, nextPos: stop, cssImport: fromClause };
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
        return { found: true, nextPos: stop, cssImport: fromClause };
      }
    }
    return { found: false, nextPos: pos };
  }

  return { found: false, nextPos: pos };
}

/**
 * Parses CSS `@import`/`composes`/`@value` statements from CSS source code,
 * tracking strings and comments so imports inside them are ignored.
 */
function parseCssImports(
  cssCode: string,
  cssFilePath: string,
  cssResult: Record<string, RelativeImport>,
  cssExternals: Record<string, ExternalImport>,
  removeCommentsWithPrefix?: string[],
  notableCommentsPrefix?: string[],
): ImportsAndComments {
  const len = cssCode.length;
  const comments: Comment[] = [];
  const statementRanges: Array<{ start: number; end: number }> = [];
  const cssImports: CssImportMatch[] = [];

  let i = 0;
  while (i < len) {
    const ch = cssCode[i];
    const next = cssCode[i + 1];

    if (ch === '/' && next === '/') {
      let end = cssCode.indexOf('\n', i);
      if (end === -1) {
        end = len;
      }
      comments.push({ type: 'Line', value: cssCode.slice(i + 2, end), start: i, end });
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = cssCode.indexOf('*/', i + 2);
      const end = close === -1 ? len : close + 2;
      comments.push({
        type: 'Block',
        value: cssCode.slice(i + 2, close === -1 ? len : close),
        start: i,
        end,
      });
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < len && cssCode[i] !== ch) {
        i += cssCode[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }

    const detection = detectCssImport(cssCode, i);
    if (detection.found) {
      if (detection.cssImport) {
        cssImports.push(detection.cssImport);
      }
      statementRanges.push({ start: i, end: detection.nextPos });
      i = detection.nextPos;
      continue;
    }

    i += 1;
  }

  const shouldProcessComments = Boolean(removeCommentsWithPrefix || notableCommentsPrefix);
  const commentResult = shouldProcessComments
    ? processCommentSpans(
        cssCode,
        comments,
        statementRanges,
        removeCommentsWithPrefix,
        notableCommentsPrefix,
      )
    : undefined;
  const mapPosition =
    commentResult?.code !== undefined
      ? commentResult.mapPosition
      : (originalPos: number) => originalPos;

  for (const cssImport of cssImports) {
    recordCssImport(cssImport, cssResult, cssExternals, cssFilePath, mapPosition);
  }

  return {
    relative: cssResult,
    externals: cssExternals,
    ...(commentResult?.code && { code: commentResult.code }),
    ...(commentResult?.comments && { comments: commentResult.comments }),
  };
}

/**
 * Parse import and export-from statements from JavaScript/TypeScript/CSS code.
 *
 * This function analyzes source code to extract all import and export-from statements,
 * categorizing them as either relative imports (local files) or external imports (packages).
 * It supports JavaScript, TypeScript, CSS, and MDX files.
 *
 * JavaScript and TypeScript sources are parsed with oxc. MDX files (and files
 * that don't parse cleanly) go through a lenient extraction that masks code
 * blocks and string contents, then parses each candidate statement individually.
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

  const isCssFile = filePath.toLowerCase().endsWith('.css');
  const isMdxFile = filePath.toLowerCase().endsWith('.mdx');

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

  // Plain JavaScript/TypeScript parses with oxc. MDX (imports interleaved with
  // markdown) and files that don't parse cleanly use the lenient extraction.
  if (!isMdxFile) {
    const oxcResult = parseJsImports(
      code,
      filePath,
      result,
      externals,
      options?.removeCommentsWithPrefix,
      options?.notableCommentsPrefix,
    );
    if (oxcResult) {
      return oxcResult;
    }
  }

  return parseImportsLeniently(
    code,
    filePath,
    isMdxFile,
    result,
    externals,
    options?.removeCommentsWithPrefix,
    options?.notableCommentsPrefix,
  );
}
