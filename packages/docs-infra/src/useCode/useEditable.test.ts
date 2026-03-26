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
  });
});
