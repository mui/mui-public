/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HastRoot } from '../CodeHighlighter/types';
import { CodeContext } from '../CodeProvider/CodeContext';
import { CodeEditor } from './CodeEditor';

function textarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** Types into the textarea the way the browser does — value then `input`. */
function type(element: HTMLTextAreaElement, value: string, caret = value.length) {
  element.value = value;
  element.setSelectionRange(caret, caret);
  fireEvent.input(element);
}

describe('CodeEditor', () => {
  it('seeds the textarea from the painted source', () => {
    render(<CodeEditor source="const value = 1;" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().value).toBe('const value = 1;');
  });

  it('keeps the source out of its own DOM subtree', () => {
    // The textarea renders inside the `<pre>`, so a `defaultValue` would become
    // a child text node and `pre.textContent` would report the source twice.
    render(<CodeEditor source="const value = 1;" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().textContent).toBe('');
  });

  it('reports edited source with the caret position', () => {
    const setSource = vi.fn();
    render(<CodeEditor source="const value = 1;" fileName="App.tsx" setSource={setSource} />);

    type(textarea(), 'const value = 2;');

    expect(setSource).toHaveBeenCalledWith(
      'const value = 2;',
      'App.tsx',
      expect.objectContaining({ line: 0, position: 16, extent: 0 }),
    );
  });

  it('reports the caret line and its text for a multi-line edit', () => {
    const setSource = vi.fn();
    render(<CodeEditor source={'first\nsecond'} fileName="App.tsx" setSource={setSource} />);

    type(textarea(), 'first\nchanged');

    expect(setSource).toHaveBeenCalledWith(
      'first\nchanged',
      'App.tsx',
      expect.objectContaining({ line: 1, content: 'changed' }),
    );
  });

  it('adopts source that did not originate in the editor', () => {
    const { rerender } = render(
      <CodeEditor source="const value = 1;" fileName="App.tsx" setSource={() => {}} />,
    );
    type(textarea(), 'edited locally');
    expect(textarea().value).toBe('edited locally');

    rerender(<CodeEditor source="reset externally" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().value).toBe('reset externally');
  });

  it('keeps a local edit when the host echoes it back', () => {
    const { rerender } = render(
      <CodeEditor source="original" fileName="App.tsx" setSource={() => {}} />,
    );
    type(textarea(), 'edited');

    rerender(<CodeEditor source="edited" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().value).toBe('edited');
  });

  it('adopts source on a file switch even when the text is identical', () => {
    const { rerender } = render(
      <CodeEditor source="shared" fileName="App.tsx" setSource={() => {}} />,
    );
    type(textarea(), 'local');

    rerender(<CodeEditor source="shared" fileName="Other.tsx" setSource={() => {}} />);
    expect(textarea().value).toBe('shared');
  });

  it('keeps the textarea out of the tab order so Tab can indent', () => {
    render(<CodeEditor source="x" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().tabIndex).toBe(-1);
  });

  it('labels the textarea with the edited file', () => {
    render(<CodeEditor source="x" fileName="App.tsx" setSource={() => {}} />);
    expect(textarea().getAttribute('aria-label')).toBe('Edit App.tsx');
  });

  it('indents at the caret on Tab', () => {
    const setSource = vi.fn();
    render(<CodeEditor source="const a = 1;" fileName="App.tsx" setSource={setSource} />);
    const element = textarea();
    element.setSelectionRange(0, 0);

    fireEvent.keyDown(element, { key: 'Tab' });

    expect(element.value).toBe('  const a = 1;');
    expect(setSource).toHaveBeenCalledWith('  const a = 1;', 'App.tsx', expect.any(Object));
  });

  it('emits once per Tab, not twice', () => {
    // jsdom has no `execCommand`, so stand one in that behaves like a browser's:
    // it edits the value AND fires `input`. Without the guard the editor reports
    // the same indent twice — once from that event, once from the key handler —
    // and reparses it twice.
    const setSource = vi.fn();
    render(<CodeEditor source="const a = 1;" fileName="App.tsx" setSource={setSource} />);
    const element = textarea();

    const execCommand = vi.fn((_command: string, _ui: boolean, text: string) => {
      const { selectionStart, selectionEnd, value } = element;
      element.value = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
      fireEvent.input(element);
      return true;
    });
    document.execCommand = execCommand as unknown as typeof document.execCommand;

    try {
      element.setSelectionRange(0, 0);
      fireEvent.keyDown(element, { key: 'Tab' });

      expect(execCommand).toHaveBeenCalledWith('insertText', false, '  ');
      expect(element.value).toBe('  const a = 1;');
      expect(setSource).toHaveBeenCalledTimes(1);
      expect(setSource).toHaveBeenCalledWith('  const a = 1;', 'App.tsx', expect.any(Object));
    } finally {
      // @ts-expect-error -- restoring the jsdom default, which is absent
      delete document.execCommand;
    }
  });

  it('outdents on Shift+Tab', () => {
    render(<CodeEditor source="    const a = 1;" fileName="App.tsx" setSource={() => {}} />);
    const element = textarea();
    element.setSelectionRange(6, 6);

    fireEvent.keyDown(element, { key: 'Tab', shiftKey: true });

    expect(element.value).toBe('  const a = 1;');
  });

  it('leaves the source alone when there is nothing to outdent', () => {
    const setSource = vi.fn();
    render(<CodeEditor source="const a = 1;" fileName="App.tsx" setSource={setSource} />);
    const element = textarea();
    element.setSelectionRange(0, 0);

    fireEvent.keyDown(element, { key: 'Tab', shiftKey: true });

    expect(element.value).toBe('const a = 1;');
    expect(setSource).not.toHaveBeenCalled();
  });

  it('does not intercept Tab combined with a modifier', () => {
    render(<CodeEditor source="const a = 1;" fileName="App.tsx" setSource={() => {}} />);
    const element = textarea();
    element.setSelectionRange(0, 0);

    fireEvent.keyDown(element, { key: 'Tab', metaKey: true });

    expect(element.value).toBe('const a = 1;');
  });

  it('exits editing on Escape', () => {
    const onExit = vi.fn();
    render(<CodeEditor source="x" fileName="App.tsx" setSource={() => {}} onExit={onExit} />);

    fireEvent.keyDown(textarea(), { key: 'Escape' });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('activates the live runtime on focus without editing', () => {
    const onActivate = vi.fn();
    const setSource = vi.fn();
    render(
      <CodeEditor source="x" fileName="App.tsx" setSource={setSource} onActivate={onActivate} />,
    );

    fireEvent.focus(textarea());

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(setSource).not.toHaveBeenCalled();
  });

  it('hands the host a pre-parsed tree when a worker parser is available', async () => {
    const setSource = vi.fn();
    const hast: HastRoot = { type: 'root', children: [] };
    const parseSourceAsync = vi.fn(() => Promise.resolve(hast));

    render(
      <CodeContext.Provider value={{ parseSourceAsync }}>
        <CodeEditor source="first" fileName="App.tsx" setSource={setSource} />
      </CodeContext.Provider>,
    );

    type(textarea(), 'second');

    await waitFor(() =>
      expect(setSource).toHaveBeenCalledWith('second', 'App.tsx', expect.any(Object), hast),
    );
  });

  it('still reports the edit when the worker parse fails', async () => {
    const setSource = vi.fn();
    const parseSourceAsync = vi.fn(() => Promise.reject(new Error('worker died')));

    render(
      <CodeContext.Provider value={{ parseSourceAsync }}>
        <CodeEditor source="first" fileName="App.tsx" setSource={setSource} />
      </CodeContext.Provider>,
    );

    type(textarea(), 'second');

    await waitFor(() =>
      expect(setSource).toHaveBeenCalledWith('second', 'App.tsx', expect.any(Object)),
    );
  });
});
