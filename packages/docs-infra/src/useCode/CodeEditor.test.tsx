/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HastRoot } from '../CodeHighlighter/types';
import { CodeContext } from '../CodeProvider/CodeContext';
import { createParseSource, resetStarryNight } from '../pipeline/parseSource/parseSource';
import { CodeEditor } from './CodeEditor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function highlighted(value: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['token'] },
        children: [{ type: 'text', value }],
      },
    ],
  };
}

describe('CodeEditor', () => {
  it('patches a focused projection into complete source using the canonical filename', () => {
    const setSource = vi.fn();
    const fullSource = 'const before = true;\nconst value = 1;\nconst after = true;';
    const projectionSource = 'const value = 1;';
    const start = fullSource.indexOf(projectionSource);

    render(
      <CodeEditor
        source={fullSource}
        sourceProjection={{ source: projectionSource, start, end: start + projectionSource.length }}
        fileName="App.tsx"
        displayFileName="App.js"
        setSource={setSource}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'const value = 2;' } });

    expect(setSource).toHaveBeenCalledWith(
      'const before = true;\nconst value = 2;\nconst after = true;',
      'App.tsx',
      expect.objectContaining({ line: 1 }),
      undefined,
      { source: 'const value = 2;', start, end: start + 'const value = 2;'.length },
    );
  });

  it('normalizes focused indentation and restores it when patching complete source', () => {
    const setSource = vi.fn();
    const projectionSource = '      first\n        second';
    const fullSource = `before\n${projectionSource}\nafter`;
    const start = fullSource.indexOf(projectionSource);

    render(
      <CodeEditor
        source={fullSource}
        sourceProjection={{
          source: projectionSource,
          start,
          end: start + projectionSource.length,
          indentation: '      ',
        }}
        fileName="App.tsx"
        setSource={setSource}
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('first\n  second');
    fireEvent.change(textarea, {
      target: { value: 'changed\n  nested', selectionStart: 3, selectionEnd: 12 },
    });

    expect(setSource).toHaveBeenCalledWith(
      'before\n      changed\n        nested\nafter',
      'App.tsx',
      expect.objectContaining({ position: start + 6 + 3, extent: 9 + 6 }),
      undefined,
      {
        source: '      changed\n        nested',
        start,
        end: start + '      changed\n        nested'.length,
        indentation: '      ',
      },
    );
  });

  it('edits complete source when expanded', () => {
    const setSource = vi.fn();

    render(
      <CodeEditor source="const value = 1;" fileName="App.tsx" setSource={setSource} expanded />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'const value = 2;' } });

    expect(setSource).toHaveBeenCalledWith(
      'const value = 2;',
      'App.tsx',
      expect.objectContaining({ line: 0 }),
      undefined,
      undefined,
    );
  });

  it('falls back to complete source when projection offsets do not match', () => {
    const setSource = vi.fn();

    render(
      <CodeEditor
        source={'before\nfocused\nafter'}
        sourceProjection={{ source: 'different', start: 7, end: 14 }}
        fileName="App.tsx"
        setSource={setSource}
      />,
    );

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'before\nfocused\nafter',
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'before\nchanged\nafter' },
    });
    expect(setSource).toHaveBeenCalledWith(
      'before\nchanged\nafter',
      'App.tsx',
      expect.any(Object),
      undefined,
      undefined,
    );
  });

  it('uses synchronous highlighting while asynchronous highlighting is pending', async () => {
    const pending = deferred<HastRoot>();
    const parseSource = vi.fn((value: string) => highlighted(value));
    const parseSourceAsync = vi.fn(() => pending.promise);

    const { container } = render(
      <CodeContext.Provider value={{ parseSource, parseSourceAsync }}>
        <CodeEditor source={'const tag = "<script>";'} fileName="code.txt" setSource={() => {}} />
      </CodeContext.Provider>,
    );

    // eslint-disable-next-line testing-library/no-container -- the highlight layer is intentionally aria-hidden
    const highlightedPre = container.querySelector('pre[aria-hidden="true"]')!;
    expect(highlightedPre.querySelector('script')).toBeNull();
    expect(highlightedPre.textContent).toContain('<script>');
    expect(highlightedPre.querySelector('.token')).not.toBeNull();
    expect(parseSource).toHaveBeenCalledWith('const tag = "<script>";', 'code.txt', undefined);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'const next = "<script>";' },
    });
    expect(highlightedPre.querySelector('.token')?.textContent).toBe('const next = "<script>";');
    expect(parseSource).toHaveBeenLastCalledWith('const next = "<script>";', 'code.txt', undefined);

    pending.resolve(highlighted('async highlighted'));
    await waitFor(() =>
      expect(highlightedPre.querySelector('.token')?.textContent).toBe('async highlighted'),
    );
    expect(parseSourceAsync).toHaveBeenCalledWith(
      'const tag = "<script>";',
      'code.txt',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('registers a cold grammar before highlighting an editable file', async () => {
    resetStarryNight();
    const parseSource = await createParseSource([]);
    const fallback = (
      <pre data-testid="highlighted-fallback">
        <code>
          <span className="pl-k">fallback</span>
        </code>
      </pre>
    );

    const { container } = render(
      <CodeContext.Provider value={{ parseSource, sourceParser: Promise.resolve(parseSource) }}>
        <CodeEditor
          source=".root { color: red; }"
          fileName="styles.css"
          setSource={() => {}}
          fallback={fallback}
        />
      </CodeContext.Provider>,
    );

    expect(screen.getByTestId('highlighted-fallback')).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() =>
      // eslint-disable-next-line testing-library/no-container -- the highlight layer is intentionally aria-hidden
      expect(container.querySelector('pre[aria-hidden="true"] [class*="pl-"]')).not.toBeNull(),
    );
    resetStarryNight();
  });

  it('ignores stale asynchronous highlight results after a later edit', async () => {
    const requests: Array<ReturnType<typeof deferred<HastRoot>>> = [];
    const parseSourceAsync = vi.fn(() => {
      const request = deferred<HastRoot>();
      requests.push(request);
      return request.promise;
    });

    const { container } = render(
      <CodeContext.Provider value={{ parseSourceAsync }}>
        <CodeEditor source="first" fileName="App.tsx" setSource={() => {}} />
      </CodeContext.Provider>,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second' } });
    await waitFor(() => expect(requests).toHaveLength(2));

    requests[1].resolve(highlighted('new highlight'));
    await waitFor(() =>
      // eslint-disable-next-line testing-library/no-container -- the highlight layer is intentionally aria-hidden
      expect(container.querySelector('pre[aria-hidden="true"] .token')?.textContent).toBe(
        'new highlight',
      ),
    );

    requests[0].resolve(highlighted('stale highlight'));
    await Promise.resolve();
    // eslint-disable-next-line testing-library/no-container -- the highlight layer is intentionally aria-hidden
    expect(container.querySelector('pre[aria-hidden="true"] .token')?.textContent).toBe(
      'new highlight',
    );
  });

  it('activates the live runtime when focused without changing source', () => {
    const onActivate = vi.fn();
    const setSource = vi.fn();

    render(
      <CodeEditor
        source="const value = 1;"
        fileName="App.tsx"
        setSource={setSource}
        onActivate={onActivate}
      />,
    );
    fireEvent.focus(screen.getByRole('textbox'));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(setSource).not.toHaveBeenCalled();
  });

  it('requests expansion when keyboard navigation crosses a focused projection boundary', () => {
    const onBoundary = vi.fn();
    render(
      <CodeEditor
        source={'before\nfocused\nafter'}
        sourceProjection={{ source: 'focused', start: 7, end: 14 }}
        fileName="App.tsx"
        setSource={() => {}}
        onBoundary={onBoundary}
      />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(onBoundary).toHaveBeenCalledTimes(1);

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(onBoundary).toHaveBeenCalledTimes(2);
  });

  it('does not request boundary expansion for complete or already-expanded source', () => {
    const onBoundary = vi.fn();
    const { rerender } = render(
      <CodeEditor
        source="complete"
        fileName="App.tsx"
        setSource={() => {}}
        onBoundary={onBoundary}
      />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    rerender(
      <CodeEditor
        source={'before\nfocused\nafter'}
        sourceProjection={{ source: 'focused', start: 7, end: 14 }}
        fileName="App.tsx"
        setSource={() => {}}
        onBoundary={onBoundary}
        expanded
      />,
    );
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(onBoundary).not.toHaveBeenCalled();
  });
});
