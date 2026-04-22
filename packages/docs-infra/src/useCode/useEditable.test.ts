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
function setup(initialContent: string, opts: { disabled?: boolean; indentation?: number } = {}) {
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
      expect(elementRemove).toHaveBeenCalledWith('keyup', expect.any(Function));

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
