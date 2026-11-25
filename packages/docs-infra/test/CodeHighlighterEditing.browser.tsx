import * as React from 'react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CodeProviderLazy } from '../src/CodeProvider/CodeProviderLazy';
import { CodeControllerContext } from '../src/CodeControllerContext';
import { createParseSource } from '../src/pipeline/parseSource/parseSource';
import { useCode } from '../src/useCode';
import { useDemoController } from '../src/useDemoController';
import { useCodeHighlighterContext } from '../src/CodeHighlighter/CodeHighlighterContext';
import { enhanceCodeEmphasis } from '../src/pipeline/enhanceCodeEmphasis';
import { applyEnhancer } from '../src/pipeline/loadIsomorphicCodeVariant/runSourceEnhancers';
import { transformSource } from '../src/pipeline/loadIsomorphicCodeVariant/transformSource';
import { computeHastDeltas } from '../src/pipeline/loadIsomorphicCodeVariant/computeHastDeltas';
import { CodeHighlighter } from '../src/CodeHighlighter/CodeHighlighter';
import type { Code, ContentProps, ControlledCode } from '../src/CodeHighlighter/types';

const MAIN_FILE = 'Demo.tsx';
const HELPER_FILE = 'randomData.ts';
const KEYWORD_SELECTOR = '.pl-k';

const TS_SOURCE = 'export const value: number = 1;';
const JS_SOURCE = 'export const value = 1;';

let code: Code;
let transformCode: Code;
let previewCode: Code;
let bundledMounts = 0;

const COUNTER_SOURCE = `import * as React from 'react';
export default function Counter() {
  const [count, setCount] = React.useState(0);
  return <button type="button" onClick={() => setCount((value) => value + 1)}>Count {count}</button>;
}`;

function Counter() {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    bundledMounts += 1;
  }, []);

  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Count {count}
    </button>
  );
}

function LiveSource(props: ContentProps<{}>) {
  const demo = useCode(props);
  const context = useCodeHighlighterContext();

  return (
    <React.Fragment>
      {context.components?.[demo.selectedVariant]}
      <section aria-label="Source">{demo.selectedFile}</section>
    </React.Fragment>
  );
}

function LiveDemo({ activation = 'interaction' }: { activation?: 'interaction' | 'idle' }) {
  const controller = useDemoController();

  return (
    <CodeProviderLazy>
      <output>{controller.components ? 'Live build ready' : 'No live build'}</output>
      <CodeControllerContext.Provider value={controller}>
        <CodeHighlighter
          precompute={previewCode}
          components={{ TypeScript: <Counter /> }}
          initialVariant="TypeScript"
          highlightAfter="init"
          enhanceAfter="init"
          initialExpanded
          editActivation={activation}
          Content={LiveSource}
        />
      </CodeControllerContext.Provider>
    </CodeProviderLazy>
  );
}

function Source(props: ContentProps<{}>) {
  const demo = useCode(props);

  return (
    <React.Fragment>
      <button type="button" onClick={() => demo.selectFileName(HELPER_FILE)}>
        Helper
      </button>
      <button type="button" onClick={() => demo.selectFileName(MAIN_FILE)}>
        Demo
      </button>
      <button type="button" onClick={() => demo.selectVariant('JavaScript')}>
        JavaScript
      </button>
      <button type="button" onClick={() => demo.selectTransform('js')}>
        JavaScript transform
      </button>
      <button type="button" onClick={() => demo.selectTransform(null)}>
        TypeScript transform
      </button>
      <section aria-label="Source">{demo.selectedFile}</section>
    </React.Fragment>
  );
}

function EditableDemo({ precompute = code }: { precompute?: Code }) {
  const [live, setLive] = React.useState<ControlledCode | null>(null);
  const controller = React.useMemo(() => ({ code: live, setCode: setLive }), [live]);

  return (
    <CodeProviderLazy>
      <output>{live ? 'Editing active' : 'Preview'}</output>
      <CodeControllerContext.Provider value={controller}>
        <CodeHighlighter
          precompute={precompute}
          initialVariant="TypeScript"
          highlightAfter="init"
          enhanceAfter="init"
          initialExpanded
          editActivation="interaction"
          Content={Source}
        />
      </CodeControllerContext.Provider>
    </CodeProviderLazy>
  );
}

describe('CodeHighlighter editing source switches', () => {
  beforeAll(async () => {
    const parseSource = await createParseSource(['source.tsx', 'source.ts', 'source.js']);

    const highlight = (source: string, fileName: string) =>
      applyEnhancer(parseSource(source, fileName), undefined, fileName, enhanceCodeEmphasis);

    code = {
      TypeScript: {
        fileName: MAIN_FILE,
        source: await highlight(TS_SOURCE, MAIN_FILE),
        extraFiles: {
          [HELPER_FILE]: { source: await highlight('export const data = [1, 2];', HELPER_FILE) },
        },
      },
      JavaScript: {
        fileName: 'Demo.jsx',
        source: await highlight(JS_SOURCE, 'Demo.jsx'),
      },
    };

    previewCode = {
      TypeScript: {
        fileName: MAIN_FILE,
        source: await highlight(COUNTER_SOURCE, MAIN_FILE),
      },
    };

    const transforms = await transformSource(TS_SOURCE, MAIN_FILE, [
      {
        extensions: ['tsx'],
        transformer: async () => ({ js: { source: JS_SOURCE, fileName: 'Demo.jsx' } }),
      },
    ]);

    transformCode = await computeHastDeltas(
      {
        TypeScript: {
          fileName: MAIN_FILE,
          source: await highlight(TS_SOURCE, MAIN_FILE),
          transforms,
        },
      },
      (source, fileName) => parseSource(source, fileName),
    );
  });

  beforeEach(() => {
    window.history.replaceState(null, '', window.location.pathname);
    window.localStorage.clear();
    bundledMounts = 0;
  });

  afterEach(cleanup);

  it('preserves the bundled preview until an edit and stays live after undo', async () => {
    render(<LiveDemo />);

    const preview = screen.getByRole('button', { name: 'Count 0' });

    await userEvent.click(preview);
    await userEvent.click(screen.getByRole('region', { name: 'Source' }).querySelector('pre')!);

    const editor = await screen.findByRole('textbox');

    await userEvent.click(editor);
    await screen.findByText('Live build ready');
    expect(screen.getByRole('button', { name: 'Count 1' })).toBe(preview);

    await userEvent.fill(editor, COUNTER_SOURCE.replace('Count ', 'Edited '));
    await screen.findByRole('button', { name: 'Edited 0' });

    const mountsBeforeUndo = bundledMounts;

    await userEvent.fill(editor, COUNTER_SOURCE);
    await userEvent.click(await screen.findByRole('button', { name: 'Count 0' }));
    await screen.findByRole('button', { name: 'Count 1' });
    expect(bundledMounts).toBe(mountsBeforeUndo);
  });

  it('initializes an idle editor and runner without remounting or focusing the demo', async () => {
    render(<LiveDemo activation="idle" />);

    const preview = screen.getByRole('button', { name: 'Count 0' });

    await userEvent.click(preview);
    expect(screen.queryByRole('textbox')).toBeNull();

    const editor = await screen.findByRole('textbox', {}, { timeout: 10000 });

    await screen.findByText('Live build ready');
    expect(screen.getByRole('button', { name: 'Count 1' })).toBe(preview);
    expect(bundledMounts).toBe(1);
    expect(document.activeElement).not.toBe(editor);

    await userEvent.fill(editor, COUNTER_SOURCE.replace('Count ', 'Edited '));
    await screen.findByRole('button', { name: 'Edited 0' });
  });

  it.each(['Helper', 'JavaScript'])(
    'keeps %s highlighted after activating another editor',
    async (label) => {
      render(<EditableDemo />);
      const source = screen.getByRole('region', { name: 'Source' });
      await waitFor(() => expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull());

      await userEvent.click(source.querySelector('pre')!);
      const editor = await screen.findByRole('textbox');
      await userEvent.click(editor);
      await screen.findByText('Editing active');
      await waitFor(() => expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull());

      await userEvent.click(screen.getByRole('button', { name: label }));

      await waitFor(() => {
        expect(source.textContent).toContain(
          label === 'Helper' ? 'export const data' : 'export const value',
        );
        expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull();
      });
      expect(source.querySelector('textarea')).toBeNull();
    },
  );

  it('preserves edited source when switching away and back', async () => {
    render(<EditableDemo />);
    const source = screen.getByRole('region', { name: 'Source' });
    await waitFor(() => expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull());

    await userEvent.click(source.querySelector('pre')!);
    const editor = await screen.findByRole('textbox');
    await userEvent.click(editor);
    await screen.findByText('Editing active');
    const edited = 'export const value: number = 42;';
    await userEvent.fill(editor, edited);
    await waitFor(() => expect(source.querySelector('textarea')?.value).toBe(edited));

    await userEvent.click(screen.getByRole('button', { name: 'Helper' }));
    await waitFor(() => expect(source.textContent).toContain('export const data'));
    await userEvent.click(screen.getByRole('button', { name: 'Demo' }));

    await waitFor(() => {
      expect(source.querySelector('pre')?.textContent).toBe(edited);
      expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull();
    });
  });

  it.each(['activate', 'edit'])('applies the JavaScript transform after %s', async (action) => {
    render(<EditableDemo precompute={transformCode} />);
    const source = screen.getByRole('region', { name: 'Source' });
    await waitFor(() => expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull());

    await userEvent.click(source.querySelector('pre')!);
    const editor = await screen.findByRole('textbox');
    await userEvent.click(editor);
    await screen.findByText('Editing active');

    if (action === 'edit') {
      await userEvent.fill(editor, 'export const value: number = 42;');
    }

    await userEvent.click(screen.getByRole('button', { name: 'JavaScript transform' }));
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(JS_SOURCE),
    );
    await waitFor(() => expect(source.querySelector(KEYWORD_SELECTOR)).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'TypeScript transform' }));
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(TS_SOURCE),
    );
  });
});
