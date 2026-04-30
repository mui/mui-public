/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditable, type Position } from './useEditable';

/**
 * Helper: place the browser selection (caret) at a given character offset
 * inside `element` so that `getPosition()` inside useEditable can read it.
 */
function placeSelection(element: HTMLElement, offset: number, extent = 0) {
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = 0;
  let startSet = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent!.length;

    if (!startSet && current + len >= offset) {
      range.setStart(node, offset - current);
      startSet = true;
      if (extent === 0) {
        range.collapse(true);
        break;
      }
    }
    if (startSet && current + len >= offset + extent) {
      range.setEnd(node, offset + extent - current);
      break;
    }
    current += len;
  }

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Renders `useEditable` bound to a real `<pre>` element and returns helpers.
 */
function setup(
  initialContent: string,
  opts: {
    disabled?: boolean;
    indentation?: number;
    minColumn?: number;
    minRow?: number;
    maxRow?: number;
    onBoundary?: () => void;
    caretSelector?: string;
  } = {},
) {
  const element = document.createElement('pre');
  element.textContent = initialContent;
  document.body.appendChild(element);

  const ref = { current: element };
  const onChange = vi.fn<(text: string, position: Position) => void>();

  const { result, unmount } = renderHook(
    (props) => useEditable(props.ref, props.onChange, props.opts),
    {
      initialProps: { ref, onChange, opts },
    },
  );

  // Place the caret at position 0 by default
  placeSelection(element, 0);

  return { element, ref, onChange, result, unmount };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

// ---------------------------------------------------------------------------
// Basic hook contract
// ---------------------------------------------------------------------------
describe('useEditable', () => {
  describe('hook return value', () => {
    it('returns an Edit object with update, insert, move, and getState', () => {
      const { result } = setup('hello');
      expect(result.current).toHaveProperty('update');
      expect(result.current).toHaveProperty('insert');
      expect(result.current).toHaveProperty('move');
      expect(result.current).toHaveProperty('getState');
      expect(typeof result.current.update).toBe('function');
      expect(typeof result.current.insert).toBe('function');
      expect(typeof result.current.move).toBe('function');
      expect(typeof result.current.getState).toBe('function');
    });

    it('returns a referentially stable Edit object across re-renders', () => {
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);
      const ref = { current: element };
      const onChange = vi.fn();

      const { result, rerender } = renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      const first = result.current;
      rerender({ ref, onChange });
      expect(result.current).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // Element setup / teardown
  // ---------------------------------------------------------------------------
  describe('element configuration', () => {
    it('sets contentEditable on the element', () => {
      const { element } = setup('hello');
      // Should be 'plaintext-only' if supported, or 'true'
      expect(['plaintext-only', 'true']).toContain(element.contentEditable);
    });

    it('sets whiteSpace to pre-wrap if not already pre', () => {
      const { element } = setup('hello');
      expect(element.style.whiteSpace).toBe('pre-wrap');
    });

    it('preserves whiteSpace when already set to pre', () => {
      const element = document.createElement('pre');
      element.style.whiteSpace = 'pre';
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn();
      renderHook(() => useEditable(ref, onChange));

      expect(element.style.whiteSpace).toBe('pre');
    });

    it('restores element styles on unmount', () => {
      const element = document.createElement('pre');
      element.style.whiteSpace = 'normal';
      element.contentEditable = 'false';
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn();
      const { unmount } = renderHook(() => useEditable(ref, onChange));

      unmount();

      expect(element.style.whiteSpace).toBe('normal');
      expect(element.contentEditable).toBe('false');
    });

    it('sets tabSize when indentation option is provided', () => {
      const { element } = setup('hello', { indentation: 4 });
      expect(element.style.tabSize).toBe('4');
    });
  });

  // ---------------------------------------------------------------------------
  // disabled option
  // ---------------------------------------------------------------------------
  describe('disabled option', () => {
    it('does not set contentEditable when disabled', () => {
      const element = document.createElement('pre');
      element.contentEditable = 'inherit';
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn();
      renderHook(() => useEditable(ref, onChange, { disabled: true }));

      expect(element.contentEditable).toBe('inherit');
    });
  });

  // ---------------------------------------------------------------------------
  // edit.getState
  // ---------------------------------------------------------------------------
  describe('getState', () => {
    it('returns text content with trailing newline', () => {
      const { result, element } = setup('hello');
      placeSelection(element, 0);
      const state = result.current.getState();
      expect(state.text).toBe('hello\n');
    });

    it('returns current position', () => {
      const { result, element } = setup('hello');
      placeSelection(element, 3);
      const state = result.current.getState();
      expect(state.position.position).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // edit.update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('calls onChange with new content', () => {
      const { result, element, onChange } = setup('hello');
      placeSelection(element, 5);

      act(() => {
        result.current.update('hello world');
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const [text] = onChange.mock.calls[0];
      expect(text).toBe('hello world');
    });

    it('adjusts position based on content length difference', () => {
      const { result, element, onChange } = setup('hello');
      placeSelection(element, 5);

      act(() => {
        result.current.update('hello world');
      });

      const [, position] = onChange.mock.calls[0];
      // Original position was 5, added 6 chars (' world'), so new position = 5 + (11 - 6) = 10
      expect(position.position).toBe(5 + ('hello world'.length - 'hello\n'.length));
    });

    it('does nothing when element ref is null', () => {
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref: { current: HTMLElement | null } = { current: element };
      const onChange = vi.fn();
      const { result } = renderHook(() => useEditable(ref, onChange));

      ref.current = null;

      act(() => {
        result.current.update('new content');
      });

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // edit.insert
  // ---------------------------------------------------------------------------
  describe('insert', () => {
    it('inserts text at caret position', () => {
      const { result, element } = setup('hello');
      placeSelection(element, 5);

      act(() => {
        result.current.insert(' world');
      });

      // insert triggers flushChanges internally through DOM mutations,
      // but in JSDOM we can verify the direct DOM manipulation happened
      // The element should now have the inserted text node
      expect(element.textContent).toContain('world');
    });

    it('does nothing when element ref is null', () => {
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref: { current: HTMLElement | null } = { current: element };
      const onChange = vi.fn();
      const { result } = renderHook(() => useEditable(ref, onChange));

      ref.current = null;

      act(() => {
        result.current.insert('text');
      });

      // Should not throw
      expect(element.textContent).toBe('hello');
    });

    it('inserts at the start of a framed line without escaping the line wrapper', () => {
      const element = document.createElement('pre');
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa\n</span>',
        '</span>',
        '<span class="frame" data-frame="1">',
        '<span class="line" data-ln="2">bbb</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { result } = renderHook(() => useEditable(ref, onChange));

      placeSelection(element, 4);

      act(() => {
        result.current.insert('x');
      });

      const frame = element.querySelector('[data-frame="1"]') as HTMLElement;
      const line = frame.querySelector('[data-ln="2"]') as HTMLElement;

      expect(frame.firstChild).toBe(line);
      expect(line.textContent).toBe('xbbb');
      expect(result.current.getState().text).toBe('aaa\nxbbb\n');
    });

    it('deletes one character before the cursor (negative offset, same-node range)', () => {
      const { result, element } = setup('hello');
      placeSelection(element, 3);

      act(() => {
        result.current.insert('', -1);
      });

      expect(element.textContent).toContain('helo');
    });

    it('deletes multiple characters before the cursor (negative offset, same-node range)', () => {
      const { result, element } = setup('hello');
      placeSelection(element, 5);

      act(() => {
        result.current.insert('', -3);
      });

      expect(element.textContent).toContain('he');
    });

    it('deletes characters spanning a node boundary (negative offset, cross-node range)', () => {
      const element = document.createElement('pre');
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa\n</span>',
        '</span>',
        '<span class="frame" data-frame="1">',
        '<span class="line" data-ln="2">bbb</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { result } = renderHook(() => useEditable(ref, onChange));

      // Place caret at position 5 ("aaa\nbb|b"), then delete 2 chars back
      // crossing the \n node boundary: removes "\nb", leaving "aaabb"
      placeSelection(element, 5);

      act(() => {
        result.current.insert('', -2);
      });

      expect(result.current.getState().text).toBe('aaabb\n');
    });

    it('inserts after </p> without merging the next framed line into the same line', () => {
      const element = document.createElement('pre');
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa\n</span>',
        '</span>',
        '<span class="frame" data-frame="1" data-frame-type="highlighted" data-frame-indent="3">',
        '<span class="line" data-ln="8">      &lt;<span class="pl-ent">p</span> <span class="pl-e">style</span><span class="pl-k">=</span><span class="pl-pse">{</span>{ color: <span class="pl-s"><span class="pl-pds">\'</span>#CA244D<span class="pl-pds">\'</span></span> }<span class="pl-pse">}</span>&gt;Type Whatever You Want Below&lt;/<span class="pl-ent">p</span>&gt;\n</span>',
        '</span>',
        '<span class="frame" data-frame="2">',
        '<span class="line" data-ln="9">    &lt;/<span class="pl-ent">div</span>&gt;</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { result } = renderHook(() => useEditable(ref, onChange, { indentation: 2 }));

      const lines = [
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>",
        '    </div>',
        '',
      ];

      placeSelection(element, lines[0].length + 1 + lines[1].length);

      act(() => {
        result.current.insert('x');
      });

      const frame = element.querySelector('[data-frame="1"]') as HTMLElement;
      const line = frame.querySelector('[data-ln="8"]') as HTMLElement;
      const nextFrame = element.querySelector('[data-frame="2"]') as HTMLElement;
      const nextLine = nextFrame.querySelector('[data-ln="9"]') as HTMLElement;
      const resultLines = result.current.getState().text.split('\n');

      expect(frame.firstChild).toBe(line);
      expect(nextFrame.firstChild).toBe(nextLine);
      expect(line.textContent).toBe(
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>x\n",
      );
      expect(resultLines).toEqual([
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>x",
        '    </div>',
        '',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // edit.move
  // ---------------------------------------------------------------------------
  describe('move', () => {
    it('accepts a numeric position', () => {
      const { result, element } = setup('hello world');
      placeSelection(element, 0);

      act(() => {
        result.current.move(5);
      });

      // Verify selection was moved
      const sel = window.getSelection()!;
      expect(sel.rangeCount).toBe(1);
    });

    it('accepts a row/column object', () => {
      const { result, element } = setup('line one\nline two');

      // Need to set initial selection
      placeSelection(element, 0);

      act(() => {
        result.current.move({ row: 1, column: 3 });
      });

      const sel = window.getSelection()!;
      expect(sel.rangeCount).toBe(1);
    });

    it('does nothing when element ref is null', () => {
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref: { current: HTMLElement | null } = { current: element };
      const onChange = vi.fn();
      const { result } = renderHook(() => useEditable(ref, onChange));

      ref.current = null;

      // Should not throw
      act(() => {
        result.current.move(3);
      });

      expect(ref.current).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Keyboard interactions
  // ---------------------------------------------------------------------------
  describe('keyboard interactions', () => {
    it('calls onChange on Enter key', () => {
      const { element } = setup('hello');
      placeSelection(element, 5);

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      // Dispatch from the element so event.target === element;
      // bubbles:true ensures the window keydown listener receives it.
      element.dispatchEvent(event);

      // The Enter handler calls edit.insert which modifies the DOM
      expect(element.textContent).toContain('\n');
    });

    it('does not handle events from other elements', () => {
      const { element, onChange } = setup('hello');
      placeSelection(element, 0);

      const otherElement = document.createElement('input');
      document.body.appendChild(otherElement);

      const event = new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      });
      otherElement.dispatchEvent(event);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not handle prevented events on keyup', () => {
      const { element, onChange } = setup('hello');
      placeSelection(element, 0);

      const event = new KeyboardEvent('keyup', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      element.dispatchEvent(event);

      // onChange should not be called for prevented events
      expect(onChange).not.toHaveBeenCalled();
    });

    it('handles Tab key with indentation', () => {
      const { element, onChange } = setup('hello', { indentation: 2 });
      placeSelection(element, 0);

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      // Tab with indentation calls edit.update which calls onChange
      expect(onChange).toHaveBeenCalled();
      const [text] = onChange.mock.calls[onChange.mock.calls.length - 1];
      // Should have added indentation spaces
      expect(text).toContain('  ');
    });

    it('handles Shift+Tab for dedent with indentation', () => {
      const { element, onChange } = setup('  hello', { indentation: 2 });
      placeSelection(element, 2);

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(onChange).toHaveBeenCalled();
    });

    it('handles plain text input synchronously in fallback contentEditable mode', () => {
      const element = document.createElement('pre');
      element.contentEditable = 'true';
      element.style.whiteSpace = 'pre-wrap';
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa\n</span>',
        '</span>',
        '<span class="frame" data-frame="1">',
        '<span class="line" data-ln="2">bbb</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();

      renderHook(() => useEditable(ref, onChange, { indentation: 2 }));

      placeSelection(element, 4);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      const frame = element.querySelector('[data-frame="1"]') as HTMLElement;
      const line = frame.querySelector('[data-ln="2"]') as HTMLElement;

      expect(keyDown.defaultPrevented).toBe(true);
      expect(frame.firstChild).toBe(line);
      expect(line.textContent).toBe('xbbb');

      const keyUp = new KeyboardEvent('keyup', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);

      expect(onChange).toHaveBeenCalled();
      const [text] = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(text).toBe('aaa\nxbbb\n');
    });

    it('keeps </div> on the next line when fallback typing inserts after </p>', () => {
      const element = document.createElement('pre');
      element.contentEditable = 'true';
      element.style.whiteSpace = 'pre-wrap';
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa</span>\n',
        '</span>',
        '<span class="frame" data-frame="1" data-frame-type="highlighted" data-frame-indent="3">',
        '<span class="line" data-ln="8">      &lt;<span class="pl-ent">p</span> <span class="pl-e">style</span><span class="pl-k">=</span><span class="pl-pse">{</span>{ color: <span class="pl-s"><span class="pl-pds">\'</span>#CA244D<span class="pl-pds">\'</span></span> }<span class="pl-pse">}</span>&gt;Type Whatever You Want Below&lt;/<span class="pl-ent">p</span>&gt;</span>\n',
        '</span>',
        '<span class="frame" data-frame="2">',
        '<span class="line" data-ln="9">    &lt;/<span class="pl-ent">div</span>&gt;</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();

      renderHook(() => useEditable(ref, onChange, { indentation: 2 }));

      const lines = [
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>",
        '    </div>',
        '',
      ];

      placeSelection(element, lines[0].length + 1 + lines[1].length);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      const keyUp = new KeyboardEvent('keyup', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);

      expect(onChange).toHaveBeenCalled();
      const [text] = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(text.split('\n')).toEqual([
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>x",
        '    </div>',
        '',
      ]);
    });

    it('repairs merged lines before onChange when fallback mode receives a merged DOM', () => {
      const element = document.createElement('pre');
      element.contentEditable = 'true';
      element.style.whiteSpace = 'pre-wrap';
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa</span>\n',
        '</span>',
        '<span class="frame" data-frame="1" data-frame-type="highlighted" data-frame-indent="3">',
        '<span class="line" data-ln="8">      &lt;<span class="pl-ent">p</span> <span class="pl-e">style</span><span class="pl-k">=</span><span class="pl-pse">{</span>{ color: <span class="pl-s"><span class="pl-pds">\'</span>#CA244D<span class="pl-pds">\'</span></span> }<span class="pl-pse">}</span>&gt;Type Whatever You Want Below&lt;/<span class="pl-ent">p</span>&gt;</span>\n',
        '</span>',
        '<span class="frame" data-frame="2">',
        '<span class="line" data-ln="9">    &lt;/<span class="pl-ent">div</span>&gt;</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();

      renderHook(() => useEditable(ref, onChange, { indentation: 2 }));

      const lines = [
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>",
        '    </div>',
        '',
      ];

      placeSelection(element, lines[0].length + 1 + lines[1].length);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      const line = element.querySelector('[data-ln="8"]') as HTMLElement;
      const nextFrame = element.querySelector('[data-frame="2"]') as HTMLElement;
      line.textContent =
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>x    </div>";
      nextFrame.remove();

      placeSelection(element, lines[0].length + 1 + lines[1].length + 1);

      const keyUp = new KeyboardEvent('keyup', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);

      expect(onChange).toHaveBeenCalled();
      const [text] = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(text.split('\n')).toEqual([
        'aaa',
        "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>x",
        '    </div>',
        '',
      ]);
    });

    it('preserves line count when rapid keydown (repeat) fires after a line-merging DOM mutation in fallback mode', () => {
      // Scenario: Firefox fallback mode, cursor at end of a line before a frame
      // boundary. User types 'x' quickly so a second keydown arrives before keyup.
      // The first keydown (non-repeat) inserts via edit.insert. Firefox then merges
      // the next frame's line into the current one (unexpected line merge). Before
      // keyup fires, a second rapid keydown arrives with repeat:true. At this point
      // state.disconnected is true (observer was disconnected during the first
      // edit.insert path via MutationObserver callbacks). The disconnected guard
      // blocks the second keydown, setting pendingContent = null via the early return.
      // When keyup finally calls flushChanges, pendingContent is null so
      // repairUnexpectedLineMerge cannot detect the merge and a line is lost.
      const element = document.createElement('pre');
      element.contentEditable = 'true';
      element.style.whiteSpace = 'pre-wrap';
      element.innerHTML = [
        '<code>',
        '<span class="frame" data-frame="0">',
        '<span class="line" data-ln="1">aaa\n</span>',
        '</span>',
        '<span class="frame" data-frame="1">',
        '<span class="line" data-ln="2">bbb</span>',
        '</span>',
        '</code>',
      ].join('');
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook(() => useEditable(ref, onChange));

      // Cursor at end of line 1 ("aaa|")
      placeSelection(element, 3);

      // First keydown — routes through isPlaintextInputKey, calls edit.insert('x')
      const keyDown1 = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        repeat: false,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown1);

      // Firefox merges lines: "aaaxbbb" — frame 1 line is now merged into frame 0
      const line1 = element.querySelector('[data-ln="1"]') as HTMLElement;
      const frame1 = element.querySelector('[data-frame="1"]') as HTMLElement;
      line1.textContent = 'aaaxbbb\n';
      frame1.remove();
      placeSelection(element, 4);

      // Second rapid keydown (key held) — state.disconnected is true here,
      // so this hits the early-return guard without setting pendingContent
      const keyDown2 = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown2);

      // keyup — flushChanges is called with pendingContent=null, so the merge repair
      // cannot run. Without the fix, onChange receives "aaaxbbb" (missing line 2).
      const keyUp = new KeyboardEvent('keyup', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0].split('\n')).toEqual(['aaaxx', 'bbb', '']);
    });
  });

  // ---------------------------------------------------------------------------
  // minColumn option
  // ---------------------------------------------------------------------------
  describe('minColumn option', () => {
    function getCaretPosition(element: HTMLElement): number {
      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    }

    it('moves ArrowLeft at minColumn to end of previous line', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      // Caret at column 4 of line 1 (right after the indent, on the "w")
      placeSelection(element, 'hello\n    '.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(getCaretPosition(element)).toBe('hello'.length);
    });

    it('moves ArrowRight at end of line to minColumn of next line', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      // Caret at end of line 0
      placeSelection(element, 'hello'.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(getCaretPosition(element)).toBe('hello\n    '.length);
    });

    it('does not intercept ArrowLeft when caret is past minColumn', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      // Caret at column 5 of line 1 (one char into "world")
      placeSelection(element, 'hello\n    w'.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept ArrowRight when caret is not at end of line', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      // Caret in the middle of line 0
      placeSelection(element, 2);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept ArrowRight when next line is not indented to minColumn', () => {
      const { element } = setup('hello\nhi', { minColumn: 4 });
      // Caret at end of line 0; next line "hi" has only 0 indent
      placeSelection(element, 'hello'.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept ArrowLeft when current line indent is shorter than minColumn', () => {
      // Caret happens to be at column 4 but the line has non-whitespace within
      // the first 4 chars — this is not the "in the indent" case.
      const { element } = setup('hello\nabcdef', { minColumn: 4 });
      placeSelection(element, 'hello\nabcd'.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept arrow keys when shift is held (selection extension)', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      placeSelection(element, 'hello\n    '.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept ArrowLeft on the first line', () => {
      const { element } = setup('    world', { minColumn: 4 });
      placeSelection(element, '    '.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing when minColumn is undefined', () => {
      const { element } = setup('hello\n    world');
      placeSelection(element, 'hello\n    '.length);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('snaps a click that lands inside the indent gutter to minColumn', () => {
      // The user clicks at column 1 of "    world" — inside the clipped
      // 4-space gutter. The mouseup handler should jump the caret to
      // column 4 (the visible start of the line).
      const { element } = setup('hello\n    world', { minColumn: 4 });
      placeSelection(element, 'hello\n '.length); // column 1 of line 1

      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      expect(pre.toString().length).toBe('hello\n    '.length);
    });

    it('does not snap a click that lands at or after minColumn', () => {
      const { element } = setup('hello\n    world', { minColumn: 4 });
      placeSelection(element, 'hello\n    wo'.length);

      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      expect(pre.toString().length).toBe('hello\n    wo'.length);
    });

    it('snaps the caret to minColumn when the editor receives focus in the gutter', async () => {
      // Tabbing into the editor lands the caret at column 0; after a frame
      // the focus handler should jump it to minColumn.
      const { element } = setup('hello\n    world', { minColumn: 4 });
      placeSelection(element, 'hello\n'.length); // column 0 of line 1

      element.dispatchEvent(new FocusEvent('focus'));
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(undefined));
      });

      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      expect(pre.toString().length).toBe('hello\n    '.length);
    });

    it('does not snap a non-collapsed selection that starts in the gutter', () => {
      // Drag selections shouldn't be clamped mid-gesture.
      const { element } = setup('hello\n    world', { minColumn: 4 });
      const textNode = element.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 'hello\n '.length);
      range.setEnd(textNode, 'hello\n    wor'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

      const after = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(after.startContainer, after.startOffset);
      expect(pre.toString().length).toBe('hello\n '.length);
    });

    it('Backspace at minColumn on a blank indented line collapses the line and lands the caret on the previous line', () => {
      // Three lines: `hello`, a blank line of exactly minColumn (4)
      // whitespace characters, and `world`. With the caret at the end of
      // the blank line (column = minColumn), Backspace would normally
      // delete one indent space and leave the caret in the clipped
      // `[0, minColumn)` gutter. Instead we collapse the entire blank
      // line so the caret lands at the end of `hello`.
      const { element, onChange } = setup('hello\n    \n    world', {
        minColumn: 4,
        indentation: 2,
      });
      placeSelection(element, 'hello\n    '.length);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      expect(keyDown.defaultPrevented).toBe(true);
      expect(element.textContent).toBe('hello\n    world');
      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      expect(pre.toString().length).toBe('hello'.length);

      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }));
      const [text] = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(text).toBe('hello\n    world\n');
    });

    it('Backspace at minColumn on a non-blank indented line falls through to a single-character delete', () => {
      // The current line has more content past `minColumn`, so the
      // collapse-blank-line shortcut should not engage.
      const { element } = setup('hello\n    world', { minColumn: 4, indentation: 2 });
      placeSelection(element, 'hello\n    '.length);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      expect(keyDown.defaultPrevented).toBe(true);
      // The fall-through path deletes a full `indentation` unit (2 chars)
      // when the pre-caret content is purely indent.
      expect(element.textContent).toBe('hello\n  world');
    });

    it('Backspace at minColumn on a blank first line falls through (no previous line to land on)', () => {
      // No `position.line > 0` to use, so we keep the default behavior.
      const { element } = setup('    \nworld', { minColumn: 4, indentation: 2 });
      placeSelection(element, '    '.length);

      const keyDown = new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      expect(keyDown.defaultPrevented).toBe(true);
      expect(element.textContent).toBe('  \nworld');
    });
  });

  // ---------------------------------------------------------------------------
  // minRow / maxRow / onBoundary options
  // ---------------------------------------------------------------------------
  describe('visible row bounds', () => {
    function getCaretPosition(element: HTMLElement): number {
      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    }

    function dispatchKey(element: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      element.dispatchEvent(event);
      return event;
    }

    describe('ArrowUp at minRow', () => {
      it('invokes onBoundary and allows native caret movement', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2, onBoundary });
        // Caret at start of row 1 ("b")
        placeSelection(element, 'a\n'.length);

        const event = dispatchKey(element, 'ArrowUp');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });

      it('does not invoke onBoundary on rows after minRow', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2, onBoundary });
        // Caret in row 2 ("c")
        placeSelection(element, 'a\nb\n'.length);

        const event = dispatchKey(element, 'ArrowUp');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).not.toHaveBeenCalled();
      });

      it('does not invoke onBoundary when shift is held (selection)', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2, onBoundary });
        placeSelection(element, 'a\n'.length);

        const event = dispatchKey(element, 'ArrowUp', { shiftKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).not.toHaveBeenCalled();
      });

      it('blocks when onBoundary is not provided', () => {
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2 });
        placeSelection(element, 'a\n'.length);
        const before = getCaretPosition(element);

        const event = dispatchKey(element, 'ArrowUp');

        expect(event.defaultPrevented).toBe(true);
        expect(getCaretPosition(element)).toBe(before);
      });
    });

    describe('ArrowDown at maxRow', () => {
      it('invokes onBoundary and allows native caret movement', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2, onBoundary });
        // Caret in row 2 ("c")
        placeSelection(element, 'a\nb\n'.length);

        const event = dispatchKey(element, 'ArrowDown');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });

      it('does not invoke onBoundary on rows before maxRow', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2, onBoundary });
        placeSelection(element, 'a\n'.length);

        const event = dispatchKey(element, 'ArrowDown');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).not.toHaveBeenCalled();
      });

      it('blocks when onBoundary is not provided', () => {
        const { element } = setup('a\nb\nc\nd', { minRow: 1, maxRow: 2 });
        placeSelection(element, 'a\nb\n'.length);

        const event = dispatchKey(element, 'ArrowDown');

        expect(event.defaultPrevented).toBe(true);
      });
    });

    describe('ArrowLeft at start of minRow', () => {
      it('invokes onBoundary and allows native caret movement at column 0', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1, onBoundary });
        // Caret at column 0 of row 1
        placeSelection(element, 'a\n'.length);

        const event = dispatchKey(element, 'ArrowLeft');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });

      it('invokes onBoundary at minColumn on indented row', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\n    bcd\ne', {
          minColumn: 4,
          minRow: 1,
          maxRow: 1,
          onBoundary,
        });
        // Caret at column minColumn (4) of row 1, lined up with "b"
        placeSelection(element, 'a\n    '.length);

        const event = dispatchKey(element, 'ArrowLeft');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });

      it('blocks when onBoundary is not provided', () => {
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1 });
        placeSelection(element, 'a\n'.length);

        const event = dispatchKey(element, 'ArrowLeft');

        expect(event.defaultPrevented).toBe(true);
      });

      it('does not invoke onBoundary mid-line on minRow', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1, onBoundary });
        // Caret in middle of row 1
        placeSelection(element, 'a\nb'.length);

        const event = dispatchKey(element, 'ArrowLeft');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).not.toHaveBeenCalled();
      });
    });

    describe('ArrowRight at end of maxRow', () => {
      it('invokes onBoundary and allows native caret movement at end of line', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1, onBoundary });
        // Caret at end of row 1
        placeSelection(element, 'a\nbcd'.length);

        const event = dispatchKey(element, 'ArrowRight');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });

      it('blocks when onBoundary is not provided', () => {
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1 });
        placeSelection(element, 'a\nbcd'.length);

        const event = dispatchKey(element, 'ArrowRight');

        expect(event.defaultPrevented).toBe(true);
      });

      it('does not invoke onBoundary mid-line on maxRow', () => {
        const onBoundary = vi.fn();
        const { element } = setup('a\nbcd\ne', { minRow: 1, maxRow: 1, onBoundary });
        // Caret mid-row
        placeSelection(element, 'a\nb'.length);

        const event = dispatchKey(element, 'ArrowRight');

        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).not.toHaveBeenCalled();
      });

      it('takes precedence over minColumn next-line jump', () => {
        const onBoundary = vi.fn();
        // maxRow == 1, next row indented to minColumn — boundary should win.
        const { element } = setup('a\nbcd\n    e', {
          minColumn: 4,
          minRow: 1,
          maxRow: 1,
          onBoundary,
        });
        placeSelection(element, 'a\nbcd'.length);

        const event = dispatchKey(element, 'ArrowRight');

        // With onBoundary provided, native movement is allowed; the
        // useEditable-driven jump to minColumn of the next line is skipped.
        expect(event.defaultPrevented).toBe(false);
        expect(onBoundary).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // caretSelector option
  // ---------------------------------------------------------------------------
  describe('caretSelector option', () => {
    /**
     * Builds a `<pre>` whose internal HTML mirrors the highlighted output:
     * `.line` spans separated by literal `\n` text nodes. Returns a helper
     * that places the collapsed selection at the given total-text offset,
     * walking the actual `.line` text nodes (not the gap nodes) so the
     * caret ends up *inside* a matching element.
     */
    function setupLined(
      linesText: string[],
      opts: {
        caretSelector?: string;
        minRow?: number;
        maxRow?: number;
        minColumn?: number;
        onBoundary?: () => void;
      } = {},
    ) {
      const element = document.createElement('pre');
      linesText.forEach((text, idx) => {
        if (idx > 0) {
          element.appendChild(document.createTextNode('\n'));
        }
        const line = document.createElement('span');
        line.className = 'line';
        line.textContent = text;
        element.appendChild(line);
      });
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { unmount } = renderHook(
        (props) => useEditable(props.ref, props.onChange, props.opts),
        { initialProps: { ref, onChange, opts } },
      );

      function placeInLine(lineIndex: number, column: number) {
        const lineSpan = element.querySelectorAll('.line')[lineIndex];
        const textNode = lineSpan.firstChild!;
        const range = document.createRange();
        range.setStart(textNode, column);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      }

      return { element, placeInLine, unmount };
    }

    function dispatchArrow(element: HTMLElement, key: string) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event;
    }

    function caretOffset(element: HTMLElement) {
      const range = window.getSelection()!.getRangeAt(0);
      const pre = document.createRange();
      pre.setStart(element, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    }

    it('synchronously moves caret to end of previous line on ArrowLeft at column 0', () => {
      const { element, placeInLine } = setupLined(['hello', 'world'], { caretSelector: '.line' });
      placeInLine(1, 0);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('hello'.length);
    });

    it('synchronously moves caret to start of next line on ArrowRight at end of line', () => {
      const { element, placeInLine } = setupLined(['hello', 'world'], { caretSelector: '.line' });
      placeInLine(0, 'hello'.length);

      const event = dispatchArrow(element, 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('hello\n'.length);
    });

    it('does not intercept ArrowLeft on the first line at column 0', () => {
      const { element, placeInLine } = setupLined(['hello', 'world'], { caretSelector: '.line' });
      placeInLine(0, 0);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not intercept ArrowLeft mid-line', () => {
      const { element, placeInLine } = setupLined(['hello', 'world'], { caretSelector: '.line' });
      placeInLine(1, 1);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(false);
    });

    it('treats a blank intermediate line as a real next line for ArrowRight at end of line', () => {
      // Regression: the chunked text-node walker used to short-circuit
      // before recording that the next row exists when that row was
      // empty, causing ArrowRight at the end of `text` to no-op instead
      // of jumping into the spacer line. Documents like
      // `text` / `<blank>` / `text` are extremely common in code samples.
      const { element, placeInLine } = setupLined(['hello', '', 'world'], {
        caretSelector: '.line',
      });
      placeInLine(0, 'hello'.length);

      const event = dispatchArrow(element, 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('hello\n'.length);
    });

    it('treats a blank intermediate line as a real next line for ArrowLeft at column 0', () => {
      // Mirror of the above for the ArrowLeft gap-jump path: the caret
      // is on the line *after* a blank one, and pressing ArrowLeft at
      // column 0 should land at the end of the (zero-length) blank
      // line rather than no-op.
      const { element, placeInLine } = setupLined(['hello', '', 'world'], {
        caretSelector: '.line',
      });
      placeInLine(2, 0);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('hello\n'.length);
    });

    it('does not intercept vertical arrows so wrapped visual lines stay native', () => {
      // ArrowUp/ArrowDown must remain unhijacked so browsers can navigate
      // wrapped visual lines in `pre-wrap` layouts. Gap nodes styled with
      // `line-height: 0` are skipped vertically by the browser anyway.
      const { element, placeInLine } = setupLined(['hello', 'world'], { caretSelector: '.line' });
      placeInLine(0, 2);

      expect(dispatchArrow(element, 'ArrowDown').defaultPrevented).toBe(false);
      placeInLine(1, 2);
      expect(dispatchArrow(element, 'ArrowUp').defaultPrevented).toBe(false);
    });

    it('does nothing when caretSelector is undefined', () => {
      const { element } = setup('hello\nworld');
      placeSelection(element, 'hello\n'.length);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not wrap when the caret is not inside a matching element', () => {
      // Plain-text editable: no `.line` spans exist, so the selector should
      // never match and the wrap should not fire even with caretSelector set.
      const { element } = setup('hello\nworld', { caretSelector: '.line' });
      placeSelection(element, 'hello\n'.length);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(false);
    });

    it('synchronously moves caret to next line on ArrowDown at maxRow before invoking onBoundary', () => {
      // With `.line` spans separated by `\n` text-node gaps, native
      // ArrowDown at the visible end would drop the caret in the gap
      // between lines (the "between-lines" trap). The hook must move
      // the caret onto the next `.line` *first*, then notify the host
      // so the expansion happens with the caret already in place.
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['hello', 'world', 'tail'], {
        caretSelector: '.line',
        maxRow: 1,
        onBoundary,
      });
      placeInLine(1, 2);

      const event = dispatchArrow(element, 'ArrowDown');

      expect(event.defaultPrevented).toBe(true);
      // Caret column (2) preserved on the newly-targeted line.
      expect(caretOffset(element)).toBe('hello\nworld\nta'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('synchronously moves caret to next line on ArrowRight at end of maxRow before invoking onBoundary', () => {
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['hello', 'world', 'tail'], {
        caretSelector: '.line',
        maxRow: 1,
        onBoundary,
      });
      placeInLine(1, 'world'.length);

      const event = dispatchArrow(element, 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      // Lands at column 0 of the next line, not in the inter-line gap.
      expect(caretOffset(element)).toBe('hello\nworld\n'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('treats a blank next line as a real line for ArrowDown at maxRow with caretSelector', () => {
      // Boundary-path coverage for the chunked-walker bug: when the row
      // immediately after `maxRow` is empty, ArrowDown must still cross
      // into it (preserving column, then invoking onBoundary) instead of
      // treating "blank line" as "no line" and no-op'ing.
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['hello', 'world', '', 'tail'], {
        caretSelector: '.line',
        maxRow: 1,
        onBoundary,
      });
      placeInLine(1, 2);

      const event = dispatchArrow(element, 'ArrowDown');

      expect(event.defaultPrevented).toBe(true);
      // Column 2 clamps to end of the blank line.
      expect(caretOffset(element)).toBe('hello\nworld\n'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('treats a blank next line as a real line for ArrowRight at end of maxRow with caretSelector', () => {
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['hello', 'world', '', 'tail'], {
        caretSelector: '.line',
        maxRow: 1,
        onBoundary,
      });
      placeInLine(1, 'world'.length);

      const event = dispatchArrow(element, 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('hello\nworld\n'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('synchronously moves caret to previous line on ArrowUp at minRow before invoking onBoundary', () => {
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['head', 'hello', 'world'], {
        caretSelector: '.line',
        minRow: 1,
        onBoundary,
      });
      placeInLine(1, 3);

      const event = dispatchArrow(element, 'ArrowUp');

      expect(event.defaultPrevented).toBe(true);
      // Column 3 clamped/preserved on previous line ('head'[3] = 'd' end).
      expect(caretOffset(element)).toBe('hea'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('synchronously moves caret to end of previous line on ArrowLeft at start of minRow before invoking onBoundary', () => {
      const onBoundary = vi.fn();
      const { element, placeInLine } = setupLined(['head', 'hello'], {
        caretSelector: '.line',
        minRow: 1,
        onBoundary,
      });
      placeInLine(1, 0);

      const event = dispatchArrow(element, 'ArrowLeft');

      expect(event.defaultPrevented).toBe(true);
      expect(caretOffset(element)).toBe('head'.length);
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it('snaps caret out of an inter-line gap text node after ArrowDown (post-keydown rAF snap)', async () => {
      // Simulate the browser's native ArrowDown behaviour landing the caret
      // in the literal `\n` text node between `.line` spans (which happens
      // when pressing Down on the last visible row of an expanded editable).
      // The handler captures the source column at keydown time and the rAF
      // snap should restore it on the destination line.
      const { element, placeInLine } = setupLined(['abcdef', 'world'], {
        caretSelector: '.line',
      });
      // Start at column 3 of "abcdef" — the column we want preserved.
      placeInLine(0, 3);

      // Dispatch ArrowDown. The handler reads the pre-move column (3)
      // synchronously before scheduling the rAF.
      dispatchArrow(element, 'ArrowDown');

      // Now simulate the browser's native default action dropping the caret
      // into the inter-line gap text node.
      const gapNode = element.childNodes[1];
      expect(gapNode.nodeType).toBe(Node.TEXT_NODE);
      const gapRange = document.createRange();
      gapRange.setStart(gapNode, 0);
      gapRange.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(gapRange);

      // Flush the rAF callback — the snap should run now.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      // Caret should be inside the next `.line` AT COLUMN 3.
      const after = window.getSelection()!.getRangeAt(0);
      const lineEl = (
        after.startContainer.nodeType === Node.ELEMENT_NODE
          ? (after.startContainer as Element)
          : after.startContainer.parentElement
      )?.closest('.line');
      expect(lineEl).not.toBeNull();
      expect(caretOffset(element)).toBe('abcdef\nwor'.length);
    });

    it('snaps caret out of an inter-line gap text node after ArrowUp (post-keydown rAF snap)', async () => {
      const { element, placeInLine } = setupLined(['abcdef', 'world'], {
        caretSelector: '.line',
      });
      // Start at column 4 of "world".
      placeInLine(1, 4);

      dispatchArrow(element, 'ArrowUp');

      // Simulate browser native dropping the caret in the gap.
      const gapNode = element.childNodes[1];
      const gapRange = document.createRange();
      gapRange.setStart(gapNode, 1);
      gapRange.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(gapRange);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const after = window.getSelection()!.getRangeAt(0);
      const lineEl = (
        after.startContainer.nodeType === Node.ELEMENT_NODE
          ? (after.startContainer as Element)
          : after.startContainer.parentElement
      )?.closest('.line');
      expect(lineEl).not.toBeNull();
      // Snapped to column 4 of the previous line ("abcdef" → "abcd|ef").
      expect(caretOffset(element)).toBe('abcd'.length);
    });

    it('clamps the preserved column to the destination line length on ArrowDown', async () => {
      const { element, placeInLine } = setupLined(['abcdefghij', 'short'], {
        caretSelector: '.line',
      });
      // Start at column 8 — longer than the destination line "short" (5 chars).
      placeInLine(0, 8);

      dispatchArrow(element, 'ArrowDown');

      const gapNode = element.childNodes[1];
      const gapRange = document.createRange();
      gapRange.setStart(gapNode, 0);
      gapRange.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(gapRange);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      // Column clamped to end of "short".
      expect(caretOffset(element)).toBe('abcdefghij\nshort'.length);
    });

    it('snaps back to the last line when ArrowDown lands past it', async () => {
      // ArrowDown on the last visible row can drop the caret into trailing
      // whitespace *after* the final `.line` (no next line to forward to).
      // The snap should then go back to the last line, preserving column.
      const { element, placeInLine } = setupLined(['hello', 'wonderful'], {
        caretSelector: '.line',
      });
      placeInLine(1, 4);

      dispatchArrow(element, 'ArrowDown');

      // Simulate browser dropping the caret in a trailing text node past
      // the last `.line`. Append a synthetic trailing text node to mimic
      // what real browsers do when they overshoot.
      const trailing = document.createTextNode('\n');
      element.appendChild(trailing);
      const trailingRange = document.createRange();
      trailingRange.setStart(trailing, 0);
      trailingRange.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(trailingRange);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const after = window.getSelection()!.getRangeAt(0);
      const lineEl = (
        after.startContainer.nodeType === Node.ELEMENT_NODE
          ? (after.startContainer as Element)
          : after.startContainer.parentElement
      )?.closest('.line');
      expect(lineEl).not.toBeNull();
      // Snapped back to column 4 of the last line ("wond|erful").
      expect(caretOffset(element)).toBe('hello\nwond'.length);
    });

    it('snaps forward to the first line when ArrowUp lands before it', async () => {
      const { element, placeInLine } = setupLined(['hello', 'world'], {
        caretSelector: '.line',
      });
      placeInLine(0, 3);

      dispatchArrow(element, 'ArrowUp');

      // Simulate browser dropping the caret in a synthetic leading text node.
      const leading = document.createTextNode('\n');
      element.insertBefore(leading, element.firstChild);
      const leadingRange = document.createRange();
      leadingRange.setStart(leading, 0);
      leadingRange.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(leadingRange);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const after = window.getSelection()!.getRangeAt(0);
      const lineEl = (
        after.startContainer.nodeType === Node.ELEMENT_NODE
          ? (after.startContainer as Element)
          : after.startContainer.parentElement
      )?.closest('.line');
      expect(lineEl).not.toBeNull();
      // Snapped forward to column 3 of the first line ("hel|lo").
      expect(caretOffset(element)).toBe('\nhel'.length);
    });

    it('snaps the caret onto the next line when a click lands in an inter-line gap node', () => {
      // Clicking between `.line` spans places the caret in the literal
      // `\n` gap text node, which is not selectable from the user's POV.
      // The mouseup handler should snap forward onto the next line so
      // typing immediately works as expected.
      const { element } = setupLined(['hello', 'world'], { caretSelector: '.line' });

      // Place caret in the gap text node between lines 0 and 1.
      const gapNode = element.childNodes[1];
      expect(gapNode.nodeType).toBe(Node.TEXT_NODE);
      const range = document.createRange();
      range.setStart(gapNode, 0);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

      const after = window.getSelection()!.getRangeAt(0);
      const lineEl = (
        after.startContainer.nodeType === Node.ELEMENT_NODE
          ? (after.startContainer as Element)
          : after.startContainer.parentElement
      )?.closest('.line');
      expect(lineEl).not.toBeNull();
      // Caret lands at the start of the next line ("|world").
      expect(caretOffset(element)).toBe('hello\n'.length);
    });
  });

  // ---------------------------------------------------------------------------
  // Undo/Redo
  // ---------------------------------------------------------------------------
  describe('undo/redo', () => {
    it('handles Ctrl+Z (undo key detection)', () => {
      const { element } = setup('hello');
      placeSelection(element, 0);

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      // Event should be prevented (undo is handled internally)
      expect(event.defaultPrevented).toBe(true);
    });

    it('handles Meta+Z (undo key detection for Mac)', () => {
      const { element } = setup('hello');
      placeSelection(element, 0);

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('does not treat Ctrl+Alt+Z as undo', () => {
      const { element } = setup('hello');
      placeSelection(element, 0);

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);

      // Alt key present, so not an undo shortcut
      expect(event.defaultPrevented).toBe(false);
    });

    it('can undo all the way back to the original content before any edits', () => {
      // Regression: trackState() guarded on !state.position, which is only set by
      // flushChanges() (first keyup). So the state before the very first edit was
      // never pushed into history. Undo could only go back to after-the-first-edit,
      // not to the original content.
      //
      // Use fallback mode (contentEditable='true') so edit.insert() is called
      // synchronously from keydown, giving MutationObserver a real DOM mutation
      // to process and making flushChanges() call onChange on keyup.
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { rerender } = renderHook(() => useEditable(ref, onChange));

      // Place cursor at end of 'hello' — this gives trackState() a live selection
      // to record from on the very first keydown (before any flushChanges has run).
      placeSelection(element, 5);

      // Type 'a'. In fallback mode the keydown handler calls edit.insert('a')
      // which mutates the DOM; flushChanges on keyup then calls onChange('helloa\n').
      const keyDown = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);
      const keyUp = new KeyboardEvent('keyup', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);

      // Verify the edit was reported
      expect(onChange).toHaveBeenCalledWith('helloa\n', expect.any(Object));

      // Simulate the re-render that would happen in a real app after onChange fires.
      // This resets state.disconnected (set to true by flushChanges) back to false
      // so the next keydown can process normally rather than hitting the disconnected guard.
      rerender();

      // Undo (Ctrl+Z) — should restore the original 'hello\n', not stay at 'helloa\n'
      const undoKey = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(undoKey);

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe('hello\n');
    });

    it('undo is not a no-op after two Enter keypresses within 500ms', () => {
      // Regression: the 500ms timestamp dedup in trackState() blocked recording a
      // new history checkpoint on the keyup after the second Enter. historyAt was
      // left pointing at the initial entry (index 0), so Ctrl+Z tried to go to
      // history[-1], found nothing, reset to 0, and never called onChange — undo
      // silently did nothing.
      //
      // Fix: trackState(ignoreTimestamp=true) is called on keyup for Enter so each
      // Enter always creates its own undo checkpoint regardless of timing.
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      let contentEditableValue = 'true';
      Object.defineProperty(element, 'contentEditable', {
        get() {
          return contentEditableValue;
        },
        set(value: string) {
          if (value === 'plaintext-only') {
            throw new DOMException(
              "Failed to set 'contentEditable': 'plaintext-only' is not supported",
            );
          }
          contentEditableValue = value;
        },
        configurable: true,
      });

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { rerender } = renderHook(() => useEditable(ref, onChange));

      // Cursor in the middle of 'hello' so Enter produces a content change
      // that differs from the original toString('hello') = 'hello\n'.
      placeSelection(element, 3);

      // First Enter
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      element.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      rerender(); // Simulate React re-render resetting state.disconnected

      // Restore cursor after flushChanges reverted the DOM
      placeSelection(element, 3);

      // Second Enter (within 500ms of the first — triggers the 500ms dedup bug)
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      element.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      rerender();

      const callsBefore = onChange.mock.calls.length;

      // Ctrl+Z — must not be a silent no-op
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(onChange.mock.calls.length).toBeGreaterThan(callsBefore);
      // Restores the content before the first Enter
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe('hello\n');
    });
  });

  // ---------------------------------------------------------------------------
  // Paste
  // ---------------------------------------------------------------------------
  describe('paste', () => {
    it('handles paste events', () => {
      const { element } = setup('hello');
      placeSelection(element, 5);

      const clipboardData = {
        getData: vi.fn().mockReturnValue(' world'),
      };

      const event = new Event('paste', { bubbles: true, cancelable: true }) as any;
      event.clipboardData = clipboardData;
      event.preventDefault = vi.fn();
      element.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(clipboardData.getData).toHaveBeenCalledWith('text/plain');
    });
  });

  // ---------------------------------------------------------------------------
  // Copy / Cut
  // ---------------------------------------------------------------------------
  describe('copy/cut', () => {
    /**
     * Builds a `<pre>` mirroring the highlighter output: `display: block`
     * `.line` spans separated by literal `\n` text node siblings. Without
     * the copy override, copying a multi-line selection on this DOM
     * produces duplicated newlines (one from each block element + the
     * explicit gap text node).
     */
    function setupLined(linesText: string[]) {
      const element = document.createElement('pre');
      linesText.forEach((text, idx) => {
        if (idx > 0) {
          element.appendChild(document.createTextNode('\n'));
        }
        const line = document.createElement('span');
        line.className = 'line';
        // Mark as block so range.toString() still produces the canonical
        // text — this also documents the layout being defended against.
        line.style.display = 'block';
        line.textContent = text;
        element.appendChild(line);
      });
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      const { unmount } = renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      function selectAcrossLines() {
        const lineSpans = element.querySelectorAll('.line');
        const startText = lineSpans[0].firstChild!;
        const endText = lineSpans[lineSpans.length - 1].firstChild!;
        const range = document.createRange();
        range.setStart(startText, 0);
        range.setEnd(endText, endText.textContent!.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      }

      return { element, selectAcrossLines, onChange, unmount };
    }

    function dispatchClipboardEvent(element: HTMLElement, type: 'copy' | 'cut') {
      const setData = vi.fn();
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);
      return { event, setData };
    }

    it('writes the canonical text to the clipboard on copy without duplicate newlines', () => {
      const { element, selectAcrossLines } = setupLined(['hello', 'world']);
      selectAcrossLines();

      const { event, setData } = dispatchClipboardEvent(element, 'copy');

      expect(event.defaultPrevented).toBe(true);
      expect(setData).toHaveBeenCalledWith('text/plain', 'hello\nworld');
    });

    it('also writes the serialized HTML fragment so rich-text paste keeps highlighting', () => {
      const { element, selectAcrossLines } = setupLined(['hello', 'world']);
      selectAcrossLines();

      const { setData } = dispatchClipboardEvent(element, 'copy');

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      expect(htmlCall).toBeDefined();
      const html = htmlCall![1];
      // Both `.line` wrappers and the literal newline gap node round-trip.
      expect(html).toContain('class="line"');
      expect(html).toContain('hello');
      expect(html).toContain('world');
      // Wrapper is a `<pre>` so monospace + whitespace context survives.
      expect(html.startsWith('<pre')).toBe(true);
    });

    it('carries the editable element className onto the clipboard wrapper', () => {
      // Consumers scope styles by class on the editable `<pre>`; keep
      // that class on the clipboard wrapper so paste targets that load
      // the same stylesheet still match.
      const element = document.createElement('pre');
      element.className = 'code-block hljs-language-tsx';
      ['hello', 'world'].forEach((text, idx) => {
        if (idx > 0) {
          element.appendChild(document.createTextNode('\n'));
        }
        const lineSpan = document.createElement('span');
        lineSpan.className = 'line';
        lineSpan.style.display = 'block';
        lineSpan.textContent = text;
        element.appendChild(lineSpan);
      });
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      const lineSpans = element.querySelectorAll('.line');
      const startText = lineSpans[0].firstChild!;
      const endText = lineSpans[lineSpans.length - 1].firstChild!;
      const range = document.createRange();
      range.setStart(startText, 0);
      range.setEnd(endText, endText.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'copy');

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      expect(html).toContain('class="code-block hljs-language-tsx"');
    });

    it('inlines the editable background color and adds rounded padding to the wrapper', () => {
      // Paste targets that do not load the editable's stylesheet should
      // still render with a card-like background + rounded corners that
      // match the source visual.
      const element = document.createElement('pre');
      element.style.backgroundColor = 'rgb(13, 17, 23)';
      ['hello', 'world'].forEach((text, idx) => {
        if (idx > 0) {
          element.appendChild(document.createTextNode('\n'));
        }
        const lineSpan = document.createElement('span');
        lineSpan.className = 'line';
        lineSpan.style.display = 'block';
        lineSpan.textContent = text;
        element.appendChild(lineSpan);
      });
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      const lineSpans = element.querySelectorAll('.line');
      const startText = lineSpans[0].firstChild!;
      const endText = lineSpans[lineSpans.length - 1].firstChild!;
      const range = document.createRange();
      range.setStart(startText, 0);
      range.setEnd(endText, endText.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'copy');
      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;

      expect(html).toContain('background-color:rgb(13, 17, 23)');
      expect(html).toContain('padding:1em');
      expect(html).toContain('border-radius:0.5em');
    });

    it('inlines computed styles so external paste targets keep highlighting without our CSS', () => {
      const element = document.createElement('pre');
      const line = document.createElement('span');
      line.className = 'line';
      const token = document.createElement('span');
      token.className = 'pl-k';
      // Inline style so jsdom's getComputedStyle returns it.
      token.style.color = 'rgb(255, 0, 0)';
      token.style.fontWeight = 'bold';
      token.textContent = 'const';
      line.appendChild(token);
      element.appendChild(line);
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      const range = document.createRange();
      range.selectNode(token);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      expect(html).toContain('color:rgb(255, 0, 0)');
      expect(html).toContain('font-weight:bold');
    });

    it('preserves the styled wrapper when only part of a single token is selected', () => {
      // `Range.cloneContents` returns a bare text node when the selection
      // is entirely inside a single text node, dropping the surrounding
      // span. Without ancestor reconstruction the partial token would
      // serialize as `<pre>ons</pre>` and lose its highlight class.
      const element = document.createElement('pre');
      const line = document.createElement('span');
      line.className = 'line';
      const token = document.createElement('span');
      token.className = 'pl-k';
      token.style.color = 'rgb(255, 0, 0)';
      token.style.fontWeight = 'bold';
      token.textContent = 'consts';
      line.appendChild(token);
      element.appendChild(line);
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      // Select "ons" — entirely inside the token's text node.
      const textNode = token.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.setEnd(textNode, 4);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      // The wrapping token span (with its highlight class) is preserved
      // and styled, and the partial text content sits inside it.
      expect(html).toContain('class="pl-k"');
      expect(html).toContain('color:rgb(255, 0, 0)');
      expect(html).toContain('font-weight:bold');
      expect(html).toContain('>ons<');
      // The intermediate `.line` ancestor is also reconstructed so the
      // block-level layout context survives.
      expect(html).toContain('class="line"');
    });

    it('preserves the styled wrapper when the selection spans multiple children of a token', () => {
      // Highlighted strings are typically rendered as
      //   <span class="pl-s"><span class="pl-pds">'</span>react<span class="pl-pds">'</span></span>
      // Selecting from inside the opening quote across to inside the
      // closing quote leaves `commonAncestorContainer` on `.pl-s`, which
      // `Range.cloneContents` would drop — losing the outer string-token
      // styling for every paste target.
      const element = document.createElement('pre');
      const line = document.createElement('span');
      line.className = 'line';
      const stringToken = document.createElement('span');
      stringToken.className = 'pl-s';
      stringToken.style.color = 'rgb(3, 47, 98)';
      const openQuote = document.createElement('span');
      openQuote.className = 'pl-pds';
      openQuote.textContent = "'";
      const middle = document.createTextNode('react');
      const closeQuote = document.createElement('span');
      closeQuote.className = 'pl-pds';
      closeQuote.textContent = "'";
      stringToken.append(openQuote, middle, closeQuote);
      line.appendChild(stringToken);
      element.appendChild(line);
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      // Select from inside the opening quote to inside the closing quote
      // — the common ancestor is the `.pl-s` element.
      const range = document.createRange();
      range.setStart(openQuote.firstChild!, 0);
      range.setEnd(closeQuote.firstChild!, 1);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      // The outer string-token wrapper is reconstructed and styled so
      // the middle text inherits the token-level color in paste targets.
      expect(html).toContain('class="pl-s"');
      expect(html).toContain('color:rgb(3, 47, 98)');
      // The inner punctuation wrappers also survive on each side of the
      // middle text.
      expect(html).toContain('class="pl-pds"');
      expect(html).toContain('react');
    });

    it('aligns style inlining when the common ancestor is the line wrapper', () => {
      // When the selection spans multiple sibling tokens inside one
      // `.line`, the common ancestor is `.line`. The style-inlining
      // walks must stay aligned: the keyword token's color should land
      // on the keyword clone, not on the reconstructed `.line` wrapper
      // or on a later sibling.
      const element = document.createElement('pre');
      const line = document.createElement('span');
      line.className = 'line';
      line.style.display = 'block';
      const keyword = document.createElement('span');
      keyword.className = 'pl-k';
      keyword.style.color = 'rgb(215, 58, 73)';
      keyword.textContent = 'const';
      const space = document.createTextNode(' ');
      const ident = document.createElement('span');
      ident.className = 'pl-c1';
      ident.style.color = 'rgb(0, 92, 197)';
      ident.textContent = 'foo';
      line.append(keyword, space, ident);
      element.appendChild(line);
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange), {
        initialProps: { ref, onChange },
      });

      // Select from inside the keyword across the space into the ident.
      const range = document.createRange();
      range.setStart(keyword.firstChild!, 2);
      range.setEnd(ident.firstChild!, 2);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      // The reconstructed `.line` wrapper must NOT inherit a token color
      // — it should only carry its own styles (display:block here).
      const lineMatch = html.match(/<span class="line"[^>]*style="([^"]*)"/);
      expect(lineMatch).not.toBeNull();
      expect(lineMatch![1]).not.toContain('rgb(215, 58, 73)');
      expect(lineMatch![1]).not.toContain('rgb(0, 92, 197)');
      // Each token clone keeps its own color on its own element.
      expect(html).toMatch(/class="pl-k"[^>]*style="[^"]*color:rgb\(215, 58, 73\)/);
      expect(html).toMatch(/class="pl-c1"[^>]*style="[^"]*color:rgb\(0, 92, 197\)/);
    });

    it('writes canonical text and clears the selection on cut', () => {
      const { element, selectAcrossLines, onChange } = setupLined(['hello', 'world']);
      selectAcrossLines();

      const { event, setData } = dispatchClipboardEvent(element, 'cut');

      expect(event.defaultPrevented).toBe(true);
      expect(setData).toHaveBeenCalledWith('text/plain', 'hello\nworld');
      // Cut should empty the selected range, leaving just the trailing \n.
      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe('\n');
    });

    it('does not intercept when the selection is collapsed', () => {
      const { element } = setupLined(['hello', 'world']);
      const lineSpan = element.querySelector('.line')!;
      const range = document.createRange();
      range.setStart(lineSpan.firstChild!, 2);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { event, setData } = dispatchClipboardEvent(element, 'copy');

      expect(event.defaultPrevented).toBe(false);
      expect(setData).not.toHaveBeenCalled();
    });

    it('does not intercept when the selection is outside the editable', () => {
      const { element } = setupLined(['hello', 'world']);
      const outside = document.createElement('div');
      outside.textContent = 'other';
      document.body.appendChild(outside);
      const range = document.createRange();
      range.selectNodeContents(outside);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { event, setData } = dispatchClipboardEvent(element, 'copy');

      expect(event.defaultPrevented).toBe(false);
      expect(setData).not.toHaveBeenCalled();
    });

    it('strips up to minColumn leading whitespace per line from text/plain', () => {
      const { element } = setup('    hello\n    world\n  short', { minColumn: 4 });
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'copy');

      const plainCall = setData.mock.calls.find((call) => call[0] === 'text/plain');
      // Lines 1-2 lose all 4 leading spaces; line 3 has only 2 to strip.
      expect(plainCall![1]).toBe('hello\nworld\nshort');
    });

    it('strips up to minColumn leading whitespace per line from text/html', () => {
      const element = document.createElement('pre');
      const lineA = document.createElement('span');
      lineA.className = 'line';
      lineA.style.display = 'block';
      lineA.textContent = '    hello';
      const lineB = document.createElement('span');
      lineB.className = 'line';
      lineB.style.display = 'block';
      lineB.textContent = '    world';
      element.appendChild(lineA);
      element.appendChild(document.createTextNode('\n'));
      element.appendChild(lineB);
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();
      renderHook((props) => useEditable(props.ref, props.onChange, props.opts), {
        initialProps: { ref, onChange, opts: { minColumn: 4 } },
      });

      const range = document.createRange();
      range.setStart(lineA.firstChild!, 0);
      range.setEnd(lineB.firstChild!, lineB.firstChild!.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: typeof setData };
      };
      event.clipboardData = { setData } as unknown as DataTransfer & { setData: typeof setData };
      element.dispatchEvent(event);

      const htmlCall = setData.mock.calls.find((call) => call[0] === 'text/html');
      const html = htmlCall![1] as string;
      // Leading 4-space indent removed from each `.line`'s text content.
      expect(html).not.toContain('    hello');
      expect(html).not.toContain('    world');
      expect(html).toContain('hello');
      expect(html).toContain('world');
    });

    it('only strips the remaining gutter portion when the selection starts mid-gutter', () => {
      // 6 spaces of indent + content, minColumn=4. User selects starting
      // from column 2 — they grabbed 2 of the 4 gutter spaces explicitly
      // plus 2 real-indent spaces. Only the remaining 2 gutter spaces
      // (minColumn - startColumn = 4 - 2) should be stripped, preserving
      // the 2 real-indent spaces in the captured text.
      const { element } = setup('      hello\n      world', { minColumn: 4 });
      const textNode = element.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, '      hello\n      world'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'copy');

      const plainCall = setData.mock.calls.find((call) => call[0] === 'text/plain');
      // First line: 4 captured spaces - 2 stripped = 2 spaces kept + "hello".
      // Second line: starts at column 0 of the document, so full 4-space
      // gutter is stripped, leaving 2 real-indent spaces + "world".
      expect(plainCall![1]).toBe('  hello\n  world');
    });

    it('strips nothing on the first line when the selection starts past the gutter', () => {
      // minColumn=4 but selection starts at column 4 — no gutter is
      // captured for the first line, so no stripping should occur there.
      const { element } = setup('      hello\n      world', { minColumn: 4 });
      const textNode = element.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, '      hello\n      world'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'copy');

      const plainCall = setData.mock.calls.find((call) => call[0] === 'text/plain');
      expect(plainCall![1]).toBe('  hello\n  world');
    });

    it('keeps the gutter whitespace in the document when cut starts inside the gutter', () => {
      // minColumn=4 — first 4 chars of each line are clipped indent
      // gutter. A drag-cut starting at column 2 of line 1 must not
      // delete the unselected/unpublished gutter chars from the
      // document: cut should be lossless against the clipboard.
      const { element, onChange } = setup('      hello\n      world', { minColumn: 4 });
      const textNode = element.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, '      hello\n      world'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const { setData } = dispatchClipboardEvent(element, 'cut');

      // Clipboard payload omits the gutter (matches what the user saw).
      const plainCall = setData.mock.calls.find((call) => call[0] === 'text/plain');
      expect(plainCall![1]).toBe('  hello\n  world');

      // The document keeps the stripped gutter chars at the cut location:
      // the 2 unselected leading chars + the 2 stripped gutter chars
      // restored = 4 spaces on line 1, then \n + 4 stripped gutter
      // spaces on line 2, then a trailing newline.
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe('    \n    \n');
    });
  });

  // ---------------------------------------------------------------------------
  // Event listener cleanup
  // ---------------------------------------------------------------------------
  describe('cleanup', () => {
    it('removes event listeners on unmount', () => {
      const windowRemove = vi.spyOn(window, 'removeEventListener');
      const documentRemove = vi.spyOn(document, 'removeEventListener');

      const { element, unmount } = setup('hello');
      const elementRemove = vi.spyOn(element, 'removeEventListener');

      unmount();

      expect(windowRemove).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(documentRemove).toHaveBeenCalledWith('selectstart', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('paste', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('copy', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('cut', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('keyup', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(elementRemove).toHaveBeenCalledWith('focus', expect.any(Function));

      windowRemove.mockRestore();
      documentRemove.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // MutationObserver
  // ---------------------------------------------------------------------------
  describe('MutationObserver', () => {
    it('observes the element for mutations', () => {
      const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');

      setup('hello');

      expect(observeSpy).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        }),
      );

      observeSpy.mockRestore();
    });

    it('disconnects the observer on unmount', () => {
      const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

      const { unmount } = setup('hello');
      unmount();

      expect(disconnectSpy).toHaveBeenCalled();

      disconnectSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Multiline content
  // ---------------------------------------------------------------------------
  describe('multiline content', () => {
    it('getState returns correct text for multiline content', () => {
      const { result, element } = setup('line 1\nline 2\nline 3');
      placeSelection(element, 0);

      const state = result.current.getState();
      expect(state.text).toBe('line 1\nline 2\nline 3\n');
    });

    it('getState tracks line number correctly', () => {
      const { result, element } = setup('line 1\nline 2\nline 3');
      // Place caret at the start of line 2
      placeSelection(element, 7);

      const state = result.current.getState();
      expect(state.position.line).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles empty content', () => {
      // An empty string sets textContent to '' which creates no child nodes.
      // toString() assumes firstChild exists, so this is a known edge case
      // that crashes. Verify the hook initializes without throwing.
      const element = document.createElement('pre');
      element.textContent = '';
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn();

      // The hook should mount without error (toString is only called on interaction)
      const { result } = renderHook(() => useEditable(ref, onChange));
      expect(result.current).toBeDefined();
    });

    it('handles null element ref gracefully', () => {
      const ref: { current: HTMLElement | null } = { current: null };
      const onChange = vi.fn();

      // Should not throw
      const { result } = renderHook(() => useEditable(ref, onChange));
      expect(result.current).toBeDefined();
    });

    it('works without options parameter', () => {
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);

      const ref = { current: element };
      const onChange = vi.fn();

      // Should not throw when opts is undefined
      const { result } = renderHook(() => useEditable(ref, onChange));
      expect(result.current).toBeDefined();
    });

    it('handles repeated key events (key held down)', () => {
      const { element } = setup('hello');
      placeSelection(element, 0);

      const event = new KeyboardEvent('keydown', {
        key: 'a',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      // Should not throw
      element.dispatchEvent(event);

      expect(element).toBeDefined();
    });

    it('does not restore stale cursor position when a re-render fires during key-hold', () => {
      // Regression: during the 100ms debounce window (repeatFlushId is set),
      // a re-render caused by an external setState (e.g. async enhancer) was
      // running the no-deps useLayoutEffect and calling setCurrentRange with the
      // stale state.position, teleporting the cursor back on every repeat
      // keydown → re-render cycle.
      const element = document.createElement('pre');
      element.textContent = 'hello';
      document.body.appendChild(element);
      const ref = { current: element };
      const onChange = vi.fn<(text: string, position: Position) => void>();

      const { result, rerender } = renderHook(
        (props) => useEditable(props.ref, props.onChange, props.opts),
        { initialProps: { ref, onChange, opts: {} } },
      );

      placeSelection(element, 0);

      // Establish a non-null state.position via edit.update.
      // This simulates the state after the user's first edit has flushed.
      act(() => {
        result.current.update('hello');
      });

      // Move the cursor to position 2 (mid-word) to simulate forward typing
      placeSelection(element, 2);

      // Dispatch a repeat keydown — this sets state.repeatFlushId (debounce timer)
      const keyDown = new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyDown);

      // Snapshot cursor position before the incidental re-render
      const selectionBefore = window.getSelection()!.getRangeAt(0).cloneRange();

      // Trigger a re-render while the debounce timer is active.
      // Without the fix, the no-deps useLayoutEffect would call setCurrentRange
      // with state.position (offset 0 from edit.update) and jump the cursor back.
      rerender({ ref, onChange: vi.fn(), opts: {} });

      // Cursor must remain at position 2, not jump back to state.position (0)
      const selectionAfter = window.getSelection()!.getRangeAt(0);
      expect(selectionAfter.startContainer).toBe(selectionBefore.startContainer);
      expect(selectionAfter.startOffset).toBe(selectionBefore.startOffset);

      // Clean up the debounce timer via keyup
      const keyUp = new KeyboardEvent('keyup', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyUp);
    });
  });
});
