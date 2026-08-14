'use client';

import * as React from 'react';
import type { EditableSourceProjection, HastRoot } from '../CodeHighlighter/types';
import { useCodeContext } from '../CodeProvider/CodeContext';
import type { SetSource } from './useSourceEditing';
import type { Position } from './editingTypes';
import { indentEdit, outdentEdit } from './codeEditorEdits';
import { patchEditableSourceProjection } from '../pipeline/loadIsomorphicCodeVariant/createEditableSourceProjection';

/**
 * A transparent textarea laid over an already-highlighted `<pre>`. The textarea
 * owns the text, so selection, undo/redo, IME, and spellcheck stay native; the
 * `<pre>` beneath it keeps painting, frames and all.
 *
 * Nothing is highlighted here. An edit goes out through `setSource`, the host
 * re-parses, and the `<pre>` re-renders from the new tree — which is what keeps
 * emphasis frames, collapse placeholders, and the intersection-driven frame
 * hydration working while editing.
 *
 * Indent and outdent go through `document.execCommand('insertText')` rather than
 * a direct value write, which is what keeps them on the browser's native undo
 * stack. The `inputType` vocabulary used to classify edits follows the approach
 * in Pierre's editor.
 */
export interface CodeEditorProps {
  /** Complete source, matching the text painted by the `<pre>` underneath. */
  source: string;
  /**
   * The slice of `source` the `<pre>` is painting, when the block is collapsed
   * to a focused window. The textarea then holds only that slice, and every
   * edit is patched back into the complete source before it goes out through
   * `setSource` — so a collapsed block can be edited in place instead of
   * expanding first.
   */
  sourceProjection?: EditableSourceProjection;
  /** Canonical file name reported back through `setSource`. */
  fileName?: string;
  language?: string;
  /** Spaces inserted by Tab. */
  tabSize?: number;
  setSource: SetSource;
  /** Fired on first focus, so the host can warm the live runtime. */
  onActivate?: () => void;
  /** Fired on Escape, so the host can move focus out. */
  onExit?: () => void;
  onReady?: (textarea: HTMLTextAreaElement | null) => void;
}

function getCaretLine(source: string, position: number): { content: string; line: number } {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < position; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { content: source.slice(lineStart, position), line };
}

/**
 * Replaces a range through `execCommand` so the edit lands on the browser's
 * native undo stack. Falls back to a direct value write where `execCommand` is
 * unavailable, which loses undo for that one edit rather than dropping it.
 */
function replaceRange(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
): void {
  textarea.setSelectionRange(start, end);
  if (document.execCommand?.('insertText', false, text)) {
    return;
  }
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
}

/**
 * Maps an offset in the projected text to the matching offset in the complete
 * source. Patching re-indents every non-blank line, so the offset shifts by one
 * indentation per non-blank line up to and including the caret's own.
 */
function toFullSourceOffset(
  projection: EditableSourceProjection,
  editedSource: string,
  offset: number,
): number {
  const indentation = projection.indentation?.length ?? 0;
  if (!indentation) {
    return projection.start + offset;
  }
  const lines = editedSource.split('\n');
  const caretLine = editedSource.slice(0, offset).split('\n').length - 1;
  let added = 0;
  for (let line = 0; line <= caretLine; line += 1) {
    if (lines[line]?.trim()) {
      added += indentation;
    }
  }
  return projection.start + offset + added;
}

export function CodeEditor({
  source,
  sourceProjection,
  fileName,
  language,
  tabSize = 2,
  setSource,
  onActivate,
  onExit,
  onReady,
}: CodeEditorProps) {
  const { parseSourceAsync } = useCodeContext();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastEmittedRef = React.useRef<string | null>(null);
  const previousFileRef = React.useRef(fileName);

  const bindTextarea = React.useCallback(
    (textarea: HTMLTextAreaElement | null) => {
      textareaRef.current = textarea;
      onReady?.(textarea);
    },
    [onReady],
  );

  // Lay the textarea directly over the `<code>` element and copy its resolved
  // font metrics. Inheriting from the `<pre>` is not enough: `<code>` and its
  // `.line` spans can carry their own font-size and line-height, and even a
  // fraction of a pixel per line compounds into visible drift further down the
  // block. Measured off `<code>` so the textarea's own size cannot feed back in.
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const pre = textarea?.parentElement;
    const code = pre?.querySelector('code');
    if (!textarea || !pre || !code) {
      return undefined;
    }

    const sync = () => {
      const styles = window.getComputedStyle(code);
      textarea.style.font = styles.font;
      textarea.style.fontFamily = styles.fontFamily;
      textarea.style.fontSize = styles.fontSize;
      textarea.style.fontWeight = styles.fontWeight;
      textarea.style.lineHeight = styles.lineHeight;
      textarea.style.letterSpacing = styles.letterSpacing;
      textarea.style.tabSize = styles.tabSize;
      // The text is transparent, so `currentcolor` would make the caret
      // invisible too. Paint it in the colour the code itself renders in.
      textarea.style.caretColor = styles.color;

      // Each line is wrapped in a frame span that carries the horizontal
      // padding, so the glyphs start inboard of `<code>`'s own box. Mirror that
      // padding or every line sits a fixed offset left of the painted text.
      const frame = code.querySelector('.frame, .line');
      const frameStyles = frame ? window.getComputedStyle(frame) : null;
      textarea.style.paddingLeft = frameStyles?.paddingLeft ?? '0px';
      textarea.style.paddingRight = frameStyles?.paddingRight ?? '0px';

      textarea.style.top = `${code.offsetTop - pre.clientTop}px`;
      textarea.style.left = `${code.offsetLeft - pre.clientLeft}px`;
      // A zero measurement means the block has not been laid out yet (or is
      // hidden). Collapsing the textarea to 0×0 would make it unclickable, and
      // nothing would resize it back if the observer never fires again, so fall
      // back to filling the `<pre>`.
      textarea.style.width = code.scrollWidth > 0 ? `${code.scrollWidth}px` : '100%';
      textarea.style.height = code.scrollHeight > 0 ? `${code.scrollHeight}px` : '100%';
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(code);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [source, sourceProjection?.source]);

  // Seeds the textarea and adopts source that did not originate here — a reset,
  // a transform swap, or a file switch. An echo of our own last edit is ignored
  // so the caret survives.
  //
  // The value is written imperatively rather than through `defaultValue`: the
  // textarea lives inside the `<pre>`, and a default value would become a child
  // text node, so `pre.textContent` would return the source twice.
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const fileChanged = previousFileRef.current !== fileName;
    previousFileRef.current = fileName;
    if (!fileChanged && source === lastEmittedRef.current) {
      return;
    }
    // The textarea holds the projected slice when there is one, since that is
    // what the `<pre>` beneath it paints.
    const nextValue = sourceProjection ? sourceProjection.source : source;
    if (textarea.value !== nextValue) {
      textarea.value = nextValue;
    }
  }, [source, sourceProjection, fileName]);

  const emit = React.useCallback(
    (editedValue: string, selectionStart: number, selectionEnd: number) => {
      // A projected edit goes out as the complete source, with the projection
      // attached so the host can re-derive the next one. The caret travels in
      // full-source coordinates too, since that is what the host re-parses.
      const nextValue = sourceProjection
        ? patchEditableSourceProjection(source, sourceProjection, editedValue)
        : editedValue;
      const caret = sourceProjection
        ? toFullSourceOffset(sourceProjection, editedValue, selectionStart)
        : selectionStart;
      // The projection that goes out describes the source that goes out: same
      // start, same hidden indentation, but the edited slice and its new end.
      const nextProjection = sourceProjection
        ? {
            ...sourceProjection,
            source: editedValue,
            end: sourceProjection.end + (nextValue.length - source.length),
          }
        : undefined;

      lastEmittedRef.current = nextValue;
      const position: Position = {
        position: caret,
        extent: selectionEnd - selectionStart,
        ...getCaretLine(nextValue, caret),
      };

      // Hand the host a pre-parsed tree when a worker parser is available, so
      // the re-highlight stays off the main thread during typing.
      if (parseSourceAsync && fileName) {
        const controller = new AbortController();
        parseSourceAsync(nextValue, fileName, language, controller.signal).then(
          (hast: HastRoot) => setSource(nextValue, fileName, position, hast, nextProjection),
          () => setSource(nextValue, fileName, position, undefined, nextProjection),
        );
        return;
      }
      setSource(nextValue, fileName, position, undefined, nextProjection);
    },
    [setSource, source, sourceProjection, fileName, language, parseSourceAsync],
  );

  // `execCommand` fires `input` synchronously, so a programmatic edit would
  // otherwise emit twice — once here with the intermediate selection, once from
  // the handler that applied it. Suppress this one and let the caller emit.
  const applyingEditRef = React.useRef(false);

  const handleInput = React.useCallback(
    (event: React.InputEvent<HTMLTextAreaElement>) => {
      if (applyingEditRef.current) {
        return;
      }
      const target = event.currentTarget;
      emit(target.value, target.selectionStart, target.selectionEnd);
    },
    [emit],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit?.();
        return;
      }
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const textarea = event.currentTarget;
      const edit = event.shiftKey
        ? outdentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, tabSize)
        : indentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, tabSize);
      if (!edit) {
        return;
      }
      event.preventDefault();
      applyingEditRef.current = true;
      try {
        replaceRange(textarea, edit.start, edit.end, edit.text);
      } finally {
        applyingEditRef.current = false;
      }
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      emit(textarea.value, edit.selectionStart, edit.selectionEnd);
    },
    [emit, onExit, tabSize],
  );

  return (
    <textarea
      ref={bindTextarea}
      className="editable-code-textarea"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={onActivate}
      // The wrapper is the tab stop, so Tab can indent instead of moving focus.
      tabIndex={-1}
      aria-label={fileName ? `Edit ${fileName}` : 'Edit code'}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      data-gramm="false"
      // Soft wrapping is the one thing that silently breaks alignment: the
      // textarea would wrap a long line that the `<pre>` renders unwrapped, and
      // every line below it would drift. `wrap="off"` is the attribute that
      // governs this — `white-space` alone does not.
      wrap="off"
      // Geometry is a correctness requirement, not theming, so it stays here
      // rather than in consumer CSS. Position, size, and font metrics are set
      // from the `<code>` element in the layout effect above; these are the
      // invariants that must hold regardless of what the consumer styles.
      style={{
        position: 'absolute',
        margin: 0,
        border: 0,
        outline: 0,
        padding: 0,
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        // Width is measured as `code.scrollWidth`, which already includes the
        // frame padding mirrored above, so the box must include it too.
        boxSizing: 'border-box',
        textIndent: 0,
        whiteSpace: 'pre',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        // The `<pre>` underneath supplies the visible glyphs. `caretColor` is
        // set from the code's own colour in the layout effect.
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
      }}
    />
  );
}
