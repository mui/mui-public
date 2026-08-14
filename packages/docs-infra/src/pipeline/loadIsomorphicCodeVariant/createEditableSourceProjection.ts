import type { EditableSourceProjection, HastRoot } from '../../CodeHighlighter/types';
import { getCollapsedFrameWindow } from '../parseSource/frameVisibility';

/**
 * Resolves the region of a complete source that a preview shows, so an edit made
 * in the collapsed view can be patched back into the full file.
 *
 * The text-matching producer mirrors what Material UI's `Demo` does with a
 * `.tsx.preview` file: it strips the leading whitespace from every line of both
 * the preview and the source, then matches. Those preview files are dedented
 * copies of a JSX fragment that keep their relative indentation, and the source
 * region they came from is indented by whatever wraps it — so the normalized
 * comparison is what lets the two meet.
 *
 * Material re-renders the patched source through the live runner, where
 * indentation does not matter. Here the patched source is displayed again, so
 * the projection also records the indentation to restore.
 *
 * Focus markers are the target producer: {@link createFocusedSourceProjection}
 * takes its offsets from the parsed tree instead of searching for the text.
 */

/**
 * Material UI's `trimLeadingSpaces` (`input.replace(/^\s+/gm, '')`), rewritten to
 * also report where each surviving character came from. Material only needs the
 * normalized text — it matches with `String.replace` and feeds the result to the
 * live runner — while a projection has to name a region of the original source.
 *
 * The whitespace run is consumed greedily from each line start, newlines
 * included, exactly as the regex does: a blank line is absorbed into the
 * following line's prefix. That is what lets a preview whose first line is blank
 * still match, and it is why the comparison is a substring match rather than a
 * line-aligned one.
 *
 * The one addition is that a `\r` terminating a line is dropped, so a CRLF
 * source matches an LF preview. Material's regex leaves that `\r` in place, but
 * its sources are all LF, so this only ever accepts more than Material does.
 */
function trimLeadingSpaces(input: string): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  let atLineStart = true;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '\r' && input[index + 1] === '\n') {
      continue;
    }
    if (atLineStart && /\s/.test(character)) {
      continue;
    }
    text += character;
    offsets.push(index);
    atLineStart = character === '\n';
  }

  return { text, offsets };
}

interface Line {
  /** Line content, without its terminator. */
  content: string;
  start: number;
  end: number;
}

function getLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\n' && character !== '\r') {
      continue;
    }
    lines.push({ content: source.slice(start, index), start, end: index });
    if (character === '\r' && source[index + 1] === '\n') {
      index += 1;
    }
    start = index + 1;
  }

  lines.push({ content: source.slice(start), start, end: source.length });
  return lines;
}

function isBlank(content: string): boolean {
  return content.trim().length === 0;
}

function dedent(contents: string[], indentation: string): string[] {
  if (!indentation) {
    return contents;
  }
  return contents.map((content) =>
    isBlank(content) ? content.trimStart() : content.slice(indentation.length),
  );
}

/** Longest whitespace prefix shared by every non-blank line. */
function getCommonIndentation(contents: string[]): string {
  let common: string | undefined;

  for (const content of contents) {
    if (isBlank(content)) {
      continue;
    }
    const indentation = /^[ \t]*/.exec(content)![0];
    if (common === undefined) {
      common = indentation;
      continue;
    }
    let length = 0;
    while (length < common.length && common[length] === indentation[length]) {
      length += 1;
    }
    common = common.slice(0, length);
  }

  return common ?? '';
}

export function createEditableSourceProjection(options: {
  fullSource: string;
  previewSource: string;
}): EditableSourceProjection | undefined {
  const { fullSource, previewSource } = options;
  if (!fullSource || !previewSource.trim()) {
    return undefined;
  }

  const target = trimLeadingSpaces(previewSource).text;
  if (!target) {
    return undefined;
  }
  const normalized = trimLeadingSpaces(fullSource);

  const starts: number[] = [];
  for (
    let index = normalized.text.indexOf(target);
    index !== -1;
    index = normalized.text.indexOf(target, index + 1)
  ) {
    starts.push(index);
  }

  if (starts.length === 0) {
    return undefined;
  }
  // Material's `String.replace` takes the first of several matches. Refusing is
  // the one deliberate difference: an edit spliced into the wrong occurrence is
  // silent, and the caller can fall back to editing the complete source.
  if (starts.length > 1) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `createEditableSourceProjection: the preview matches ${starts.length} regions of the source, so no projection is safe. Make the preview unambiguous, or use focus markers.`,
      );
    }
    return undefined;
  }

  const matchStart = normalized.offsets[starts[0]];
  const end = normalized.offsets[starts[0] + target.length - 1] + 1;
  // Take the region from the line start when only whitespace precedes the match,
  // so the indentation the preview dropped is inside the region and can be
  // restored on patch-back. A preview that starts mid-line — `<CircularProgress
  // />` against `return <CircularProgress />` — keeps the code before it out of
  // the region, exactly as Material's replace does.
  const lineStart = fullSource.lastIndexOf('\n', matchStart - 1) + 1;
  const start = fullSource.slice(lineStart, matchStart).trim() === '' ? lineStart : matchStart;

  const contents = getLines(fullSource.slice(start, end)).map((line) => line.content);
  const indentation = getCommonIndentation(contents);

  return {
    // The region as the collapsed view shows it. For a well-formed preview file
    // this is the preview text; deriving it from the source instead means an
    // edit always patches back exactly, even for the handful of previews that
    // carry a stray blank line or an odd indent.
    source: dedent(contents, indentation).join('\n'),
    start,
    end,
    ...(indentation ? { indentation } : null),
  };
}

/**
 * Derives the projection from focus markers, using the window the collapsed view
 * shows. This is the target producer: the offsets come from the parsed source
 * rather than from searching for the rendered text, so nothing can be ambiguous.
 *
 * Reads the same {@link getCollapsedFrameWindow} walk that `<Pre>`'s caret bounds
 * read, so the slice the editor edits is exactly the region the caret is held
 * inside.
 *
 * Returns `undefined` when the visible lines are not contiguous, or when they
 * cover the whole file — the collapsed view then hides nothing and the editor
 * can edit the complete source directly.
 */
export function createFocusedSourceProjection(
  source: string,
  root: HastRoot,
  collapseToEmpty = false,
): EditableSourceProjection | undefined {
  const collapsed = getCollapsedFrameWindow(root, collapseToEmpty);
  if (!collapsed?.contiguousLines || collapsed.minLine === undefined) {
    return undefined;
  }

  const fullLines = getLines(source);
  const window = fullLines.slice(collapsed.minLine - 1, collapsed.maxLine);
  if (window.length === 0 || window.length >= fullLines.length) {
    return undefined;
  }

  const contents = window.map((line) => line.content);
  const indentation = getCommonIndentation(contents);

  return {
    // Dedented for display, the way a `.tsx.preview` file is authored.
    source: dedent(contents, indentation).join('\n'),
    start: window[0].start,
    end: window[window.length - 1].end,
    ...(indentation ? { indentation } : null),
  };
}

/**
 * Writes an edited projection back into the complete source, restoring the
 * indentation the collapsed view hid.
 */
export function patchEditableSourceProjection(
  fullSource: string,
  projection: EditableSourceProjection,
  editedSource: string,
): string {
  const { indentation } = projection;
  const patched = indentation
    ? editedSource
        .split('\n')
        .map((line) => (isBlank(line) ? line : `${indentation}${line}`))
        .join('\n')
    : editedSource;

  return `${fullSource.slice(0, projection.start)}${patched}${fullSource.slice(projection.end)}`;
}
