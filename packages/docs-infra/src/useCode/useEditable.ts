/*

MIT License

Copyright (c) 2020 Phil Plückthun,
Copyright (c) 2021 Formidable
Copyright (c) 2026 Material-UI SAS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// Forked from https://github.com/FormidableLabs/use-editable
// Changes:
// - Fix linting and formatting

import * as React from 'react';

export interface Position {
  position: number;
  extent: number;
  content: string;
  line: number;
}

type History = [Position, string];

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

const getCurrentRange = () => window.getSelection()!.getRangeAt(0)!;

const setCurrentRange = (range: Range) => {
  const selection = window.getSelection()!;
  selection.empty();
  selection.addRange(range);
};

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ';

const toString = (element: HTMLElement): string => {
  const queue: Node[] = [element.firstChild!];

  let content = '';
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (node.nodeType === Node.TEXT_NODE) {
      content += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      content += '\n';
    }

    if (node.nextSibling) {
      queue.push(node.nextSibling);
    }
    if (node.firstChild) {
      queue.push(node.firstChild);
    }
  }

  // contenteditable Quirk: Without plaintext-only a pre/pre-wrap element must always
  // end with at least one newline character
  if (content[content.length - 1] !== '\n') {
    content += '\n';
  }

  return content;
};

const setStart = (range: Range, node: Node, offset: number) => {
  if (offset < node.textContent!.length) {
    range.setStart(node, offset);
  } else {
    range.setStartAfter(node);
  }
};

const setEnd = (range: Range, node: Node, offset: number) => {
  if (offset < node.textContent!.length) {
    range.setEnd(node, offset);
  } else {
    range.setEndAfter(node);
  }
};

const getPosition = (element: HTMLElement): Position => {
  // Firefox Quirk: Since plaintext-only is unsupported the position
  // of the text here is retrieved via a range, rather than traversal
  // as seen in makeRange()
  const range = getCurrentRange();
  const extent = !range.collapsed ? range.toString().length : 0;
  const untilRange = document.createRange();
  untilRange.setStart(element, 0);
  untilRange.setEnd(range.startContainer, range.startOffset);
  let content = untilRange.toString();
  const position = content.length;
  const lines = content.split('\n');
  const line = lines.length - 1;
  content = lines[line];
  return { position, extent, content, line };
};

const makeRange = (element: HTMLElement, start: number, end?: number): Range => {
  if (start <= 0) {
    start = 0;
  }
  if (!end || end < 0) {
    end = start;
  }

  const range = document.createRange();
  const queue: Node[] = [element.firstChild!];
  let current = 0;

  let position = start;
  while (queue.length > 0) {
    const node = queue[queue.length - 1];
    if (!node) {
      break;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent!.length;
      if (current + length >= position) {
        const offset = position - current;
        if (position === start) {
          setStart(range, node, offset);
          if (end !== start) {
            position = end;
            continue;
          } else {
            break;
          }
        } else {
          setEnd(range, node, offset);
          break;
        }
      }

      current += node.textContent!.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
      if (current + 1 >= position) {
        if (position === start) {
          setStart(range, node, 0);
          if (end !== start) {
            position = end;
            continue;
          } else {
            break;
          }
        } else {
          setEnd(range, node, 0);
          break;
        }
      }

      current += 1;
    }

    queue.pop();
    if (node.nextSibling) {
      queue.push(node.nextSibling);
    }
    if (node.firstChild) {
      queue.push(node.firstChild);
    }
  }

  return range;
};

interface State {
  observer: MutationObserver;
  disconnected: boolean;
  onChange(text: string, position: Position): void;
  queue: MutationRecord[];
  history: History[];
  historyAt: number;
  position: Position | null;
}

export interface Options {
  disabled?: boolean;
  indentation?: number;
}

export interface Edit {
  /** Replaces the entire content of the editable while adjusting the caret position. */
  update(content: string): void;
  /** Inserts new text at the caret position while deleting text in range of the offset (which accepts negative offsets). */
  insert(append: string, offset?: number): void;
  /** Positions the caret where specified */
  move(pos: number | { row: number; column: number }): void;
  /** Returns the current editor state, as usually received in onChange */
  getState(): { text: string; position: Position };
}

export const useEditable = (
  elementRef: { current: HTMLElement | undefined | null },
  onChange: (text: string, position: Position) => void,
  opts?: Options,
): Edit => {
  if (!opts) {
    opts = {};
  }

  const unblock = React.useState([])[1];
  const state: State = React.useState(() => {
    const initialState: State = {
      observer: null as any,
      disconnected: false,
      onChange,
      queue: [],
      history: [],
      historyAt: -1,
      position: null,
    };

    if (typeof MutationObserver !== 'undefined') {
      initialState.observer = new MutationObserver((batch) => {
        initialState.queue.push(...batch);
      });
    }

    return initialState;
  })[0];

  const edit = React.useMemo<Edit>(
    () => ({
      update(content: string) {
        const { current: element } = elementRef;
        if (element) {
          const position = getPosition(element);
          const prevContent = toString(element);
          position.position += content.length - prevContent.length;
          state.position = position;
          state.onChange(content, position);
        }
      },
      insert(append: string, deleteOffset?: number) {
        const { current: element } = elementRef;
        if (element) {
          let range = getCurrentRange();
          range.deleteContents();
          range.collapse();
          const position = getPosition(element);
          const offset = deleteOffset || 0;
          const start = position.position + (offset < 0 ? offset : 0);
          const end = position.position + (offset > 0 ? offset : 0);
          range = makeRange(element, start, end);
          range.deleteContents();
          if (append) {
            range.insertNode(document.createTextNode(append));
          }
          setCurrentRange(makeRange(element, start + append.length));
        }
      },
      move(pos: number | { row: number; column: number }) {
        const { current: element } = elementRef;
        if (element) {
          element.focus();
          let position = 0;
          if (typeof pos === 'number') {
            position = pos;
          } else {
            const lines = toString(element).split('\n').slice(0, pos.row);
            if (pos.row) {
              position += lines.join('\n').length + 1;
            }
            position += pos.column;
          }

          setCurrentRange(makeRange(element, position));
        }
      },
      getState() {
        const { current: element } = elementRef;
        const text = toString(element!);
        const position = getPosition(element!);
        return { text, position };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  React.useLayoutEffect(() => {
    // Only for SSR / server-side logic
    if (typeof navigator !== 'object') {
      return undefined;
    }

    state.onChange = onChange;

    if (!elementRef.current || opts!.disabled) {
      return undefined;
    }

    state.disconnected = false;
    state.observer.observe(elementRef.current, observerSettings);
    if (state.position) {
      const { position, extent } = state.position;
      setCurrentRange(makeRange(elementRef.current, position, position + extent));
    }

    return () => {
      state.observer.disconnect();
    };
  });

  React.useLayoutEffect(() => {
    if (typeof navigator !== 'object') {
      return undefined;
    }

    if (!elementRef.current || opts!.disabled) {
      state.history.length = 0;
      state.historyAt = -1;
      return undefined;
    }

    const element = elementRef.current!;
    if (state.position) {
      element.focus();
      const { position, extent } = state.position;
      setCurrentRange(makeRange(element, position, position + extent));
    }

    const prevWhiteSpace = element.style.whiteSpace;
    const prevContentEditable = element.contentEditable;
    let hasPlaintextSupport = true;
    try {
      // Firefox and IE11 do not support plaintext-only mode
      element.contentEditable = 'plaintext-only';
    } catch (_error) {
      element.contentEditable = 'true';
      hasPlaintextSupport = false;
    }

    if (prevWhiteSpace !== 'pre') {
      element.style.whiteSpace = 'pre-wrap';
    }

    if (opts!.indentation) {
      const tabSizeValue = `${opts!.indentation}`;
      (element.style as any).MozTabSize = tabSizeValue;
      element.style.tabSize = tabSizeValue;
    }

    const indentPattern = `${' '.repeat(opts!.indentation || 0)}`;
    const indentRe = new RegExp(`^(?:${indentPattern})`);
    const blanklineRe = new RegExp(`^(?:${indentPattern})*(${indentPattern})$`);

    let trackStateTimestamp: number;
    const trackState = (ignoreTimestamp?: boolean) => {
      if (!elementRef.current || !state.position) {
        return;
      }

      const content = toString(element);
      const position = getPosition(element);
      const timestamp = new Date().valueOf();

      // Prevent recording new state in list if last one has been new enough
      const lastEntry = state.history[state.historyAt];
      if (
        (!ignoreTimestamp && timestamp - trackStateTimestamp < 500) ||
        (lastEntry && lastEntry[1] === content)
      ) {
        trackStateTimestamp = timestamp;
        return;
      }

      state.historyAt += 1;
      const at = state.historyAt;
      state.history[at] = [position, content];
      state.history.splice(at + 1);
      if (at > 500) {
        state.historyAt -= 1;
        state.history.shift();
      }
    };

    const disconnect = () => {
      state.observer.disconnect();
      state.disconnected = true;
    };

    const flushChanges = () => {
      state.queue.push(...state.observer.takeRecords());
      const position = getPosition(element);
      if (state.queue.length) {
        disconnect();
        const content = toString(element);
        state.position = position;
        while (state.queue.length > 0) {
          const mutation = state.queue.pop()!;
          if (mutation.oldValue !== null) {
            mutation.target.textContent = mutation.oldValue;
          }
          for (let i = mutation.removedNodes.length - 1; i >= 0; i -= 1) {
            mutation.target.insertBefore(mutation.removedNodes[i], mutation.nextSibling);
          }
          for (let i = mutation.addedNodes.length - 1; i >= 0; i -= 1) {
            if (mutation.addedNodes[i].parentNode) {
              mutation.target.removeChild(mutation.addedNodes[i]);
            }
          }
        }

        state.onChange(content, position);
      }
    };

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented || event.target !== element) {
        return;
      }
      if (state.disconnected) {
        // React Quirk: It's expected that we may lose events while disconnected, which is why
        // we'd like to block some inputs if they're unusually fast. However, this always
        // coincides with React not executing the update immediately and then getting stuck,
        // which can be prevented by issuing a dummy state change.
        event.preventDefault();
        unblock([]);
        return;
      }

      if (isUndoRedoKey(event)) {
        event.preventDefault();

        let history: History;
        if (!event.shiftKey) {
          state.historyAt -= 1;
          const at = state.historyAt;
          history = state.history[at];
          if (!history) {
            state.historyAt = 0;
          }
        } else {
          state.historyAt += 1;
          const at = state.historyAt;
          history = state.history[at];
          if (!history) {
            state.historyAt = state.history.length - 1;
          }
        }

        if (history) {
          disconnect();
          state.position = history[0];
          state.onChange(history[1], history[0]);
        }
        return;
      }

      trackState();

      if (event.key === 'Enter') {
        event.preventDefault();
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only newline characters are inserted
        const position = getPosition(element);
        // We also get the current line and preserve indentation for the next
        // line that's created
        const match = /\S/g.exec(position.content);
        const index = match ? match.index : position.content.length;
        const text = `\n${position.content.slice(0, index)}`;
        edit.insert(text);
      } else if ((!hasPlaintextSupport || opts!.indentation) && event.key === 'Backspace') {
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only a single character is deleted
        event.preventDefault();
        const range = getCurrentRange();
        if (!range.collapsed) {
          edit.insert('', 0);
        } else {
          const position = getPosition(element);
          const match = blanklineRe.exec(position.content);
          edit.insert('', match ? -match[1].length : -1);
        }
      } else if (opts!.indentation && event.key === 'Tab') {
        event.preventDefault();
        const position = getPosition(element);
        const start = position.position - position.content.length;
        const content = toString(element);
        const newContent = event.shiftKey
          ? content.slice(0, start) +
            position.content.replace(indentRe, '') +
            content.slice(start + position.content.length)
          : content.slice(0, start) +
            (opts!.indentation ? ' '.repeat(opts!.indentation) : '\t') +
            content.slice(start);
        edit.update(newContent);
      }

      // Flush changes as a key is held so the app can catch up
      if (event.repeat) {
        flushChanges();
      }
    };

    const onKeyUp = (event: HTMLElementEventMap['keyup']) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (!isUndoRedoKey(event)) {
        trackState();
      }
      flushChanges();
      // Chrome Quirk: The contenteditable may lose focus after the first edit or so
      element.focus();
    };

    const onSelect = (event: Event) => {
      // Chrome Quirk: The contenteditable may lose its selection immediately on first focus
      state.position =
        window.getSelection()!.rangeCount && event.target === element ? getPosition(element) : null;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      trackState(true);
      edit.insert(event.clipboardData!.getData('text/plain'));
      trackState(true);
      flushChanges();
    };

    document.addEventListener('selectstart', onSelect);
    window.addEventListener('keydown', onKeyDown);
    element.addEventListener('paste', onPaste);
    element.addEventListener('keyup', onKeyUp);

    return () => {
      document.removeEventListener('selectstart', onSelect);
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('keyup', onKeyUp);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementRef.current, opts?.disabled, opts?.indentation]);

  return edit;
};
