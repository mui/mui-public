'use client';

import * as React from 'react';
import type { HastRoot } from '../CodeHighlighter/types';
import { useCodeContext } from '../CodeProvider/CodeContext';
import type { SetSource } from './useSourceEditing';
import type { Position } from './editingTypes';
import { indentEdit, outdentEdit } from './codeEditorEdits';

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
 * in Pierre's editor (https://github.com/pierrecomputer/pierre).
 */
export interface CodeEditorProps {
  /** Complete source, matching the text painted by the `<pre>` underneath. */
  source: string;
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

export function CodeEditor({
  source,
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
      textarea.style.width = `${code.scrollWidth}px`;
      textarea.style.height = `${code.scrollHeight}px`;
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(code);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [source]);

  // Adopt source that did not originate here — a reset, a transform swap, or a
  // file switch. An echo of our own last edit is ignored so the caret survives.
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const fileChanged = previousFileRef.current !== fileName;
    previousFileRef.current = fileName;
    if (!fileChanged && source === lastEmittedRef.current) {
      return;
    }
    if (textarea.value !== source) {
      textarea.value = source;
    }
  }, [source, fileName]);

  const emit = React.useCallback(
    (nextValue: string, selectionStart: number, selectionEnd: number) => {
      lastEmittedRef.current = nextValue;
      const position: Position = {
        position: selectionStart,
        extent: selectionEnd - selectionStart,
        ...getCaretLine(nextValue, selectionStart),
      };

      // Hand the host a pre-parsed tree when a worker parser is available, so
      // the re-highlight stays off the main thread during typing.
      if (parseSourceAsync && fileName) {
        const controller = new AbortController();
        parseSourceAsync(nextValue, fileName, language, controller.signal).then(
          (hast: HastRoot) => setSource(nextValue, fileName, position, hast),
          () => setSource(nextValue, fileName, position),
        );
        return;
      }
      setSource(nextValue, fileName, position);
    },
    [setSource, fileName, language, parseSourceAsync],
  );

  const handleInput = React.useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
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
      replaceRange(textarea, edit.start, edit.end, edit.text);
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      emit(textarea.value, edit.selectionStart, edit.selectionEnd);
    },
    [emit, onExit, tabSize],
  );

  return (
    <textarea
      ref={bindTextarea}
      className="editable-code-textarea"
      defaultValue={source}
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
