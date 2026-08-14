/**
 * Pure text edits behind the editor's Tab handling. Each returns the range to
 * replace, the replacement text, and where the selection lands afterwards, so
 * the caller can apply it through `execCommand` and stay on the native undo
 * stack.
 */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Expands a range to cover the whole of every line it touches. */
function toLineRange(source: string, start: number, end: number) {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = source.indexOf('\n', end);
  if (lineEnd === -1) {
    lineEnd = source.length;
  }
  return { lineStart, lineEnd };
}

/** True when the selection covers more than one line. */
function isMultiLine(source: string, start: number, end: number) {
  return source.slice(start, end).includes('\n');
}

/**
 * Tab. A caret inserts spaces up to the next tab stop; a multi-line selection
 * indents every line it touches and keeps the whole block selected.
 */
export function indentEdit(
  source: string,
  start: number,
  end: number,
  tabSize: number,
): TextEdit | null {
  const indent = ' '.repeat(tabSize);

  if (start === end && !isMultiLine(source, start, end)) {
    // Align to the next tab stop rather than always inserting a full tab width.
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const column = start - lineStart;
    const width = tabSize - (column % tabSize) || tabSize;
    const text = ' '.repeat(width);
    return {
      start,
      end,
      text,
      selectionStart: start + width,
      selectionEnd: start + width,
    };
  }

  const { lineStart, lineEnd } = toLineRange(source, start, end);
  const block = source.slice(lineStart, lineEnd);
  const text = block
    .split('\n')
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join('\n');

  return {
    start: lineStart,
    end: lineEnd,
    text,
    selectionStart: lineStart,
    selectionEnd: lineStart + text.length,
  };
}

/** Shift+Tab. Removes up to `tabSize` leading spaces from every touched line. */
export function outdentEdit(
  source: string,
  start: number,
  end: number,
  tabSize: number,
): TextEdit | null {
  const { lineStart, lineEnd } = toLineRange(source, start, end);
  const block = source.slice(lineStart, lineEnd);

  let removedFromFirstLine = 0;
  let removedTotal = 0;
  const text = block
    .split('\n')
    .map((line, index) => {
      let removable = 0;
      while (removable < tabSize && line[removable] === ' ') {
        removable += 1;
      }
      if (index === 0) {
        removedFromFirstLine = removable;
      }
      removedTotal += removable;
      return line.slice(removable);
    })
    .join('\n');

  if (removedTotal === 0) {
    return null;
  }

  if (start === end) {
    const caret = Math.max(lineStart, start - removedFromFirstLine);
    return { start: lineStart, end: lineEnd, text, selectionStart: caret, selectionEnd: caret };
  }

  return {
    start: lineStart,
    end: lineEnd,
    text,
    selectionStart: lineStart,
    selectionEnd: lineStart + text.length,
  };
}
