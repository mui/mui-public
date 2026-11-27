import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, server, userEvent } from 'vitest/browser';
import type { CDPSession } from '@vitest/browser-playwright';
import { useCodeFallback } from '../CodeHighlighter/useCodeFallback';
import { fallbackToHast } from '../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import { CodeProviderLazy } from '../CodeProvider/CodeProviderLazy';
import { useCode } from '../useCode';
import { NativeCodeSource } from './index';
import type { CodeSourceProps } from './index';

const FILE = 'example.tsx';
const FOCUSED = '  return 1;';
const BEFORE = 'function example(): number {\n';
const AFTER = '\n}';
const INITIAL = BEFORE + FOCUSED + AFTER;
const WINDOW = { source: FOCUSED, indentation: '  ' };

const FALLBACK: FallbackNode[] = [
  ['span', 'frame', BEFORE],
  [
    'span',
    'frame',
    { dataFrameType: 'focus', dataFrameIndent: 1 },
    ['  ', ['span', 'pl-k', 'return'], ' 1;\n'],
  ],
  ['span', 'frame', '}'],
];

const HAST = fallbackToHast(FALLBACK);
const CONTENT = { code: { Default: { fileName: FILE, source: HAST } } };

function FileInput({ fileName }: CodeSourceProps) {
  return <textarea aria-label={fileName} defaultValue={INITIAL} />;
}

function SourceSlot({ stage }: { stage: 'loading' | 'live' }) {
  const loading = useCodeFallback(
    { fileNames: [FILE], source: FALLBACK },
    { SourceComponent: FileInput },
  );

  const live = useCode(CONTENT, { SourceComponent: FileInput });

  return stage === 'loading' ? loading.selectedFile : live.selectedFile;
}

type SourceView = 'collapsed' | 'expanded' | 'javascript';

function Demo({ stage, view = 'collapsed' }: { stage: 'loading' | 'live'; view?: SourceView }) {
  const [typescript, setTypescript] = React.useState(INITIAL);
  const [javascript, setJavascript] = React.useState(INITIAL.replace(': number', ''));
  const source = view === 'javascript' ? javascript : typescript;
  const setSource = view === 'javascript' ? setJavascript : setTypescript;

  const [projection, setProjection] = React.useState({
    source: FOCUSED,
    start: BEFORE.length,
    end: BEFORE.length + FOCUSED.length,
    indentation: '  ',
  });

  const loading = useCodeFallback(
    {
      fileNames: [FILE],
      source: FALLBACK,
      sourceWindow: WINDOW,
      totalLines: 3,
      focusedLines: 1,
      collapsible: true,
    },
    { SourceComponent: NativeCodeSource },
  );

  return (
    <CodeProviderLazy>
      {stage === 'loading' ? (
        loading.selectedFile
      ) : (
        <NativeCodeSource
          key={FILE}
          fileName={FILE}
          displayFileName={view === 'javascript' ? 'example.js' : FILE}
          expanded={view !== 'collapsed'}
          sourceProjection={projection}
          shouldHighlight
          setSource={(next, _file, _selection, _tree, nextProjection) => {
            setSource(next);

            if (nextProjection) {
              setProjection({ ...nextProjection, indentation: nextProjection.indentation ?? '' });
            }
          }}
        >
          {source === INITIAL ? HAST : source}
        </NativeCodeSource>
      )}
      <output>{source}</output>
    </CodeProviderLazy>
  );
}

describe('selected source surface', () => {
  afterEach(cleanup);

  it('preserves a custom source from the loading hook to the live selection', () => {
    const view = <SourceSlot stage="loading" />;
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(view);
    const input = container.querySelector('textarea');
    expect(input?.value).toBe(INITIAL);
    const { rerender } = render(view, { container, hydrate: true });
    rerender(<SourceSlot stage="live" />);
    expect(container.querySelector('textarea')).toBe(input);
  });

  it('binds the server input in place and edits the focused lines of the complete source', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = ReactDOMServer.renderToString(<Demo stage="loading" />);
    const input = container.querySelector('textarea')!;
    const wrapper = container.querySelector<HTMLElement>('[role="group"]')!;
    expect(input.readOnly).toBe(true);
    expect(wrapper.tabIndex).toBe(-1);
    expect(input.tabIndex).toBe(0);
    expect(input.value).toBe('return 1;');
    expect(container.querySelector('.pl-k')?.textContent).toBe('return');

    const { rerender } = render(<Demo stage="loading" />, { container, hydrate: true });
    rerender(<Demo stage="live" />);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.readOnly).toBe(false);
    expect(wrapper.tabIndex).toBe(0);
    expect(input.tabIndex).toBe(-1);
    await userEvent.tab();
    expect(document.activeElement).toBe(wrapper);
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(wrapper);
    expect(input.value).toBe('return 1;');
    expect(container.querySelector('.pl-k')?.textContent).toBe('return');

    await userEvent.click(input);
    input.setSelectionRange(7, 8);
    await userEvent.keyboard('2');
    expect(input.value).toBe('return 2;');
    expect(screen.getByRole('status').textContent).toBe(`${BEFORE}  return 2;${AFTER}`);
    await waitFor(() => expect(container.querySelector('.pl-k')?.textContent).toBe('return'), {
      timeout: 15000,
    });
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.selectionStart).toBe(8);
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(input.value).toBe('return 1;');
  });

  it.each(['expanded', 'javascript'] as const)('keeps undo inside the %s source', async (view) => {
    const from = view === 'expanded' ? 'collapsed' : 'expanded';
    const { rerender } = render(<Demo stage="live" view={from} />);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    await userEvent.click(input);
    const digit = input.value.indexOf('1');
    input.setSelectionRange(digit, digit + 1);
    await userEvent.keyboard('2');
    expect(input.value).toContain('return 2;');
    rerender(<Demo stage="live" view={view} />);

    const expected =
      view === 'expanded' ? INITIAL.replace('1', '2') : INITIAL.replace(': number', '');

    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe(expected);
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(input.value).toBe(expected);
    expect(screen.getByRole('status').textContent).toBe(expected);

    input.setSelectionRange(expected.indexOf('return'), expected.indexOf('return') + 6);
    await userEvent.keyboard('x');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(input.value).toBe(expected);
  });

  it.runIf(server.browser === 'chromium')(
    'keeps composition and undo across highlighting',
    async () => {
      const { container } = render(<Demo stage="live" />);
      const input = container.querySelector('textarea')!;
      await userEvent.click(input);
      input.setSelectionRange(7, 8);

      const session: CDPSession = cdp();
      await session.send('Input.imeSetComposition', {
        text: '日',
        selectionStart: 1,
        selectionEnd: 1,
      });
      expect(input.value).toBe('return 日;');
      await waitFor(() => expect(container.querySelector('.pl-k')?.textContent).toBe('return'), {
        timeout: 15000,
      });
      await session.send('Input.insertText', { text: '日本' });
      expect(screen.getByRole('textbox')).toBe(input);
      expect(input.value).toBe('return 日本;');
      expect(screen.getByRole('status').textContent).toBe(`${BEFORE}  return 日本;${AFTER}`);
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(input.value).toBe('return 日;');
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(input.value).toBe('return 1;');
    },
  );
});
