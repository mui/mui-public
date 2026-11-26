import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCodeFallback } from '../CodeHighlighter/useCodeFallback';
import { parsePlainText } from '../pipeline/parseSource';
import { Pre } from './Pre';

const LINE_HEIGHT = 20;
const SOURCE = 'const value = 1;\n\nconst next = value + 1;\n\n';
const LINE_COUNT = 4;

function LoadingSource({ source }: { source: string }) {
  const { code } = useCodeFallback({
    fileNames: ['Demo.ts'],
    source: [['span', 'frame', source]],
    totalLines: LINE_COUNT,
    focusedLines: LINE_COUNT,
  });

  return <pre>{code}</pre>;
}

function SourceLayout({
  source,
  stage,
}: {
  source: string;
  stage: 'loading' | 'plain' | 'highlighted';
}) {
  return (
    <div className="source-layout">
      <style>{`
        .source-layout pre { margin: 0; font: 13px/${LINE_HEIGHT}px monospace; }
        .source-layout code, .source-layout .frame { display: block; }
        .source-layout .frame[data-lined] { line-height: 0; }
        .source-layout .frame[data-lined] .line {
          display: block;
          white-space: pre;
          line-height: ${LINE_HEIGHT}px;
        }
      `}</style>
      {stage === 'loading' ? (
        <LoadingSource source={source} />
      ) : (
        <Pre fileName="Demo.ts" shouldHighlight={stage === 'highlighted'} editable={false}>
          {parsePlainText(source)}
        </Pre>
      )}
    </div>
  );
}

describe('Pre line layout - browser', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    { name: 'LF', source: SOURCE },
    { name: 'CRLF', source: SOURCE.replaceAll('\n', '\r\n') },
  ])('preserves block lines and blank-line height through loading: $name', ({ source }) => {
    const { container, rerender } = render(<SourceLayout source={source} stage="loading" />);

    for (const stage of ['loading', 'plain', 'highlighted'] as const) {
      if (stage !== 'loading') {
        rerender(<SourceLayout source={source} stage={stage} />);
      }

      const code = container.querySelector('code');
      expect(code?.textContent?.replaceAll('\r\n', '\n')).toBe(SOURCE);

      const lines = Array.from(container.querySelectorAll('.frame > .line'));
      expect(lines).toHaveLength(LINE_COUNT);

      for (const line of lines) {
        expect(getComputedStyle(line).display).toBe('block');
        expect(line.getBoundingClientRect().height).toBe(LINE_HEIGHT);
      }

      expect(code?.getBoundingClientRect().height).toBe(LINE_COUNT * LINE_HEIGHT);
    }
  });
});

describe('Pre editor - browser', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the wrapper as one Tab stop, Enter to engage, and Escape to exit', async () => {
    render(
      <Pre fileName="App.tsx" setSource={() => {}}>
        {'const value = 1;'}
      </Pre>,
    );

    const wrapper = screen.getByRole('group', { name: 'Editable code' });
    await userEvent.tab();
    expect(document.activeElement).toBe(wrapper);

    await userEvent.keyboard('{Enter}');
    const textarea = await screen.findByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea.tabIndex).toBe(-1);

    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(wrapper);

    await userEvent.tab();
    expect(document.activeElement).not.toBe(textarea);
  });

  it('indents with Tab while engaged', async () => {
    const setSource = vi.fn();
    render(
      <Pre fileName="App.tsx" setSource={setSource}>
        {'const value = 1;'}
      </Pre>,
    );

    const wrapper = screen.getByRole('group', { name: 'Editable code' });
    wrapper.focus();
    await userEvent.keyboard('{Enter}');
    const textarea = await screen.findByRole('textbox');
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 0);
    await userEvent.keyboard('{Tab}');

    expect((textarea as HTMLTextAreaElement).value).toBe('  const value = 1;');
    expect(setSource).toHaveBeenLastCalledWith(
      '  const value = 1;',
      'App.tsx',
      expect.objectContaining({ position: 2 }),
      undefined,
      undefined,
    );
  });

  it('engages directly from a pointer and activates without an edit', async () => {
    const onActivate = vi.fn();
    const { container } = render(
      <Pre
        fileName="App.tsx"
        setSource={() => {}}
        editActivation="interaction"
        onActivate={onActivate}
      >
        {'const value = 1;'}
      </Pre>,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(container.querySelector('pre')!);

    const textarea = await screen.findByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
