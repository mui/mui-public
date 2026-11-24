import * as React from 'react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CodeProviderLazy } from '../src/CodeProvider/CodeProviderLazy';
import { CodeControllerContext } from '../src/CodeControllerContext';
import { createParseSource } from '../src/pipeline/parseSource/parseSource';
import { useCode } from '../src/useCode';
import { enhanceCodeEmphasis } from '../src/pipeline/enhanceCodeEmphasis';
import { applyEnhancer } from '../src/pipeline/loadIsomorphicCodeVariant/runSourceEnhancers';
import { CodeHighlighter } from '../src/CodeHighlighter/CodeHighlighter';
import type { Code, ContentProps, ControlledCode } from '../src/CodeHighlighter/types';

const MAIN_FILE = 'Demo.tsx';
const HELPER_FILE = 'randomData.ts';
const KEYWORD_SELECTOR = '.pl-k';

let code: Code;

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
      <section aria-label="Source">{demo.selectedFile}</section>
    </React.Fragment>
  );
}

function EditableDemo() {
  const [live, setLive] = React.useState<ControlledCode | null>(null);
  const controller = React.useMemo(() => ({ code: live, setCode: setLive }), [live]);

  return (
    <CodeProviderLazy>
      <output>{live ? 'Editing active' : 'Preview'}</output>
      <CodeControllerContext.Provider value={controller}>
        <CodeHighlighter
          precompute={code}
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
        source: await highlight('export const value: number = 1;', MAIN_FILE),
        extraFiles: {
          [HELPER_FILE]: { source: await highlight('export const data = [1, 2];', HELPER_FILE) },
        },
      },
      JavaScript: {
        fileName: 'Demo.jsx',
        source: await highlight('export const value = 1;', 'Demo.jsx'),
      },
    };
  });

  beforeEach(() => {
    window.history.replaceState(null, '', window.location.pathname);
    window.localStorage.clear();
  });

  afterEach(cleanup);

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
});
