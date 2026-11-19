/**
 * Splits `@pierre/highlights` tokens into pieces the HAST builder can map one
 * by one. The lexer attaches surrounding whitespace to tokens and merges
 * adjacent tokens of one type (`"0 4px "`, `"&& !"`), so whitespace is split
 * off, merged runs are split apart, and bracket runs (`")}"`) become one piece
 * per character for brace tracking.
 */

export interface Piece {
  text: string;
  /** Token type without the `var(--hls-` wrapper; `''` for whitespace and plain text. */
  type: string;
}

const COLOR_PREFIX = 'var(--hls-';

/** Token types rendered as plain text. */
const PLAIN_TYPES = new Set(['', 'none', 'foreground', 'text-jsx', 'embedded']);

export function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isStringType(type: string): boolean {
  return type === 'string' || type === 'string-escape';
}

function isCommentType(type: string): boolean {
  return type === 'comment' || type === 'comment-doc';
}

/** Types whose text keeps internal whitespace: prose-like runs that are one token by design. */
function keepsInternalWhitespace(type: string): boolean {
  return (
    isStringType(type) ||
    isCommentType(type) ||
    type.startsWith('string') ||
    type.startsWith('emphasis') ||
    type.startsWith('link') ||
    type.startsWith('diff') ||
    type === 'title' ||
    type === 'text-literal' ||
    type === 'tag-doctype' ||
    type === 'attribute' ||
    PLAIN_TYPES.has(type)
  );
}

export function tokenType(color: string | undefined): string {
  if (!color?.startsWith(COLOR_PREFIX)) {
    return '';
  }
  return color.slice(COLOR_PREFIX.length, -1);
}

/** Splits one lexer token into pieces, appending them to `out`. */
export function splitToken(
  text: string,
  type: string,
  out: Piece[],
  isFirstOnLine: boolean,
  isLastOnLine: boolean,
): void {
  if (PLAIN_TYPES.has(type) || (isFirstOnLine && text.trim() === '')) {
    out.push({ text, type: '' });
    return;
  }
  if (isCommentType(type) && isFirstOnLine) {
    const trimmed = text.trimStart();
    if (trimmed.length < text.length) {
      out.push({ text: text.slice(0, text.length - trimmed.length), type: '' });
      splitToken(trimmed, type, out, false, isLastOnLine);
      return;
    }
  }
  if (isCommentType(type) && !isLastOnLine) {
    out.push({ text, type });
    return;
  }
  let start = 0;
  let end = text.length;
  if (isCommentType(type)) {
    while (end > 0 && isWhitespace(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    if (end > 0) {
      out.push({ text: text.slice(0, end), type });
    }
    if (end < text.length) {
      out.push({ text: text.slice(end), type: '' });
    }
    return;
  }
  while (start < end && isWhitespace(text.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isWhitespace(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  if (start === end) {
    out.push({ text, type: '' });
    return;
  }
  if (start > 0) {
    out.push({ text: text.slice(0, start), type: '' });
  }
  const core = text.slice(start, end);
  if (keepsInternalWhitespace(type)) {
    out.push({ text: core, type });
  } else if (type === 'punctuation-bracket') {
    for (const char of core) {
      out.push({ text: char, type: isWhitespace(char.charCodeAt(0)) ? '' : type });
    }
  } else {
    let index = 0;
    while (index < core.length) {
      const wordStart = index;
      while (index < core.length && !isWhitespace(core.charCodeAt(index))) {
        index += 1;
      }
      out.push({ text: core.slice(wordStart, index), type });
      const spaceStart = index;
      while (index < core.length && isWhitespace(core.charCodeAt(index))) {
        index += 1;
      }
      if (index > spaceStart) {
        out.push({ text: core.slice(spaceStart, index), type: '' });
      }
    }
  }
  if (end < text.length) {
    out.push({ text: text.slice(end), type: '' });
  }
}

/** Splits source into lines and the terminator that follows each one. */
export function splitLines(source: string): { lines: string[]; terminators: string[] } {
  const lines: string[] = [];
  const terminators: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10 || code === 13) {
      lines.push(source.slice(start, index));
      const crlf = code === 13 && source.charCodeAt(index + 1) === 10;
      terminators.push(crlf ? '\r\n' : source[index]);
      index += crlf ? 1 : 0;
      start = index + 1;
    }
  }
  lines.push(source.slice(start));
  terminators.push('');
  return { lines, terminators };
}
