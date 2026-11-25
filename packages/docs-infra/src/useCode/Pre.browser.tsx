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

  it('initializes a visible idle editor without moving focus and preserves the first clicked caret', async () => {
    const source = Array.from(
      { length: 40 },
      (_, index) => `const value_${index} = ${index};`,
    ).join('\n');

    const { container } = render(
      <div style={{ font: `13px/${LINE_HEIGHT}px monospace` }}>
        <button type="button">Keep focus</button>
        <div data-testid="scroller" style={{ height: 120, overflow: 'auto' }}>
          <Pre fileName="App.ts" setSource={() => {}} editActivation="idle">
            {source}
          </Pre>
        </div>
        <div style={{ position: 'absolute', top: 10000 }}>
          <Pre fileName="Offscreen.ts" setSource={() => {}} editActivation="idle">
            {source}
          </Pre>
        </div>
        <Pre fileName="Readonly.ts" editable={false} editActivation="idle">
          {source}
        </Pre>
        <div hidden>
          <Pre fileName="Hidden.ts" setSource={() => {}} editActivation="idle">
            {source}
          </Pre>
        </div>
      </div>,
    );

    const focusTarget = screen.getByRole('button', { name: 'Keep focus' });

    await userEvent.click(focusTarget);
    expect(container.querySelector('textarea')).toBeNull();

    const textarea = await screen.findByRole(
      'textbox',
      { name: 'Edit App.ts' },
      { timeout: 10000 },
    );

    expect(document.activeElement).toBe(focusTarget);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);

    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = LINE_HEIGHT * 20;
    const scrollTop = scroller.scrollTop;
    const pageScroll = window.scrollY;

    await userEvent.click(textarea, { position: { x: 60, y: scrollTop + LINE_HEIGHT } });

    expect(document.activeElement).toBe(textarea);
    expect((textarea as HTMLTextAreaElement).selectionStart).toBeGreaterThan(
      source.indexOf('value_19'),
    );
    expect(scroller.scrollTop).toBe(scrollTop);
    expect(window.scrollY).toBe(pageScroll);
  });

  it('cancels initialization when the source is hidden and resumes on reopening', async () => {
    function ToggleSource() {
      const [visible, setVisible] = React.useState(true);
      const [activations, setActivations] = React.useState(0);

      return (
        <React.Fragment>
          <button type="button" onClick={() => setVisible((value) => !value)}>
            Toggle code
          </button>
          <output>Activations: {activations}</output>
          <div hidden={!visible}>
            <Pre
              fileName="App.ts"
              setSource={() => {}}
              editActivation="idle"
              onActivate={() => setActivations((value) => value + 1)}
            >
              {'const value = 1;'}
            </Pre>
          </div>
        </React.Fragment>
      );
    }

    const { container } = render(<ToggleSource />);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      await userEvent.click(screen.getByRole('button', { name: 'Toggle code' }));
      await vi.advanceTimersByTimeAsync(2000);

      expect(container.querySelector('textarea')).toBeNull();
      expect(screen.getByText('Activations: 0')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }

    await userEvent.click(screen.getByRole('button', { name: 'Toggle code' }));
    await screen.findByRole('textbox', {}, { timeout: 10000 });

    expect(screen.getByText('Activations: 1')).not.toBeNull();
  });

  it('keeps interaction activation available before idle initialization', async () => {
    render(
      <Pre fileName="App.ts" setSource={() => {}} editActivation="idle">
        {'const value = 1;'}
      </Pre>,
    );

    await userEvent.click(screen.getByRole('group', { name: 'Editable code' }));

    const textarea = await screen.findByRole('textbox');

    await waitFor(() => expect(document.activeElement).toBe(textarea));
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
