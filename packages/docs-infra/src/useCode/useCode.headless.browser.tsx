import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ContentProps, ControlledCode } from '../CodeHighlighter/types';
import { CodeHighlighterContext } from '../CodeHighlighter/CodeHighlighterContext';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { CodeControllerContext } from '../CodeControllerContext/CodeControllerContext';
import { useCode } from './useCode';
import type { UseCodeOpts } from './useCode';
import { preloadSourceEditingEngine } from './useSourceEditing';
import { preloadCodeEditor } from './codeEditorCache';

beforeAll(async () => {
  // A cold edit waits on the editing engine; the internal editor is a second
  // chunk. Warm both so a mounted editor is observable synchronously.
  await preloadSourceEditingEngine();
  await preloadCodeEditor();
});

const FILE_NAME = 'CheckboxBasic.tsx';

const INITIAL_SOURCE = ['export default function CheckboxBasic() {', '  return <div />;', '}'].join(
  '\n',
);

const contentProps: ContentProps<{}> = {
  slug: 'headless-demo',
  code: { Default: { fileName: FILE_NAME, source: INITIAL_SOURCE } },
};

const PROJECTED_SLICE = '<div />';
const projectedContentProps: ContentProps<{}> = {
  slug: 'projected-demo',
  code: {
    Default: {
      fileName: FILE_NAME,
      source: INITIAL_SOURCE,
      sourceProjection: {
        source: PROJECTED_SLICE,
        start: INITIAL_SOURCE.indexOf(PROJECTED_SLICE),
        end: INITIAL_SOURCE.indexOf(PROJECTED_SLICE) + PROJECTED_SLICE.length,
      },
    },
  },
};

/**
 * A host that owns the controlled code and renders its own editing surface, the
 * way Material UI keeps `DemoEditor`. The block's own `<pre>` stays the preview:
 * an edit leaves through `setSource`, the controller commits it, and `useCode`
 * hands the new source back to the rendered file.
 */
function HeadlessHost({ opts }: { opts?: UseCodeOpts }) {
  const [code, setCode] = React.useState<ControlledCode | null>(null);
  const controller = React.useMemo(() => ({ code: code ?? undefined, setCode }), [code]);
  // `CodeHighlighter` normally does this: the controlled code reaches the block
  // through the highlighter context, and edits leave through `setCode`.
  const highlighter = React.useMemo(
    () => ({ code: code ?? undefined, setCode }) as CodeHighlighterContextType,
    [code],
  );

  return (
    <CodeControllerContext.Provider value={controller}>
      <CodeHighlighterContext.Provider value={highlighter}>
        <HeadlessBlock opts={opts} />
      </CodeHighlighterContext.Provider>
    </CodeControllerContext.Provider>
  );
}

function ProjectedHost() {
  const [code, setCode] = React.useState<ControlledCode | null>(null);
  const controller = React.useMemo(() => ({ code: code ?? undefined, setCode }), [code]);

  return (
    <CodeControllerContext.Provider value={controller}>
      <ProjectedBlock />
    </CodeControllerContext.Provider>
  );
}

/** A host whose editor holds only the projected slice, as a collapsed panel does. */
function ProjectedBlock() {
  const code = useCode(projectedContentProps, { editorMode: 'headless' });

  return (
    <React.Fragment>
      <textarea
        aria-label="host editor"
        value={code.selectedFileProjection?.source ?? ''}
        onChange={(event) => code.setProjectedSource?.(event.target.value)}
      />
      <span data-testid="full">{code.selectedFileSource ?? ''}</span>
    </React.Fragment>
  );
}

function HeadlessBlock({ opts }: { opts?: UseCodeOpts }) {
  const code = useCode(contentProps, { editorMode: 'headless', ...opts });

  return (
    <React.Fragment>
      <span data-testid="editable">{String(code.selectedFileEditable)}</span>
      <span data-testid="language">{code.selectedFileLanguage ?? ''}</span>
      <span data-testid="original-name">{code.selectedFileOriginalName ?? ''}</span>
      <textarea
        aria-label="host editor"
        value={code.selectedFileSource ?? ''}
        onFocus={() => code.activateEditing?.()}
        onChange={(event) => code.setSource?.(event.target.value)}
      />
      <div data-testid="preview">{code.selectedFile}</div>
    </React.Fragment>
  );
}

afterEach(cleanup);

describe('useCode headless editing', () => {
  it('exposes the selected file as decoded text a host can render', async () => {
    render(<HeadlessHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    expect(editor.value).toBe(INITIAL_SOURCE);
    expect(screen.getByTestId('editable').textContent).toBe('true');
    expect(screen.getByTestId('language').textContent).toBe('tsx');
    expect(screen.getByTestId('original-name').textContent).toBe(FILE_NAME);
  });

  it('mounts no editor of its own, so the host owns the editing DOM', () => {
    render(<HeadlessHost />);

    // The host textarea is the only one on the page; `<Pre>` renders read-only.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByTestId('preview').querySelector('textarea')).toBe(null);
  });

  it('updates the rendered preview when the host edits through setSource', async () => {
    render(<HeadlessHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    await userEvent.click(editor);
    await userEvent.fill(editor, INITIAL_SOURCE.replace('<div />', '<span />'));

    await waitFor(() => {
      expect(screen.getByTestId('preview').textContent).toContain('<span />');
    });
    expect(editor.value).toContain('<span />');
  });

  it('mounts its own editor in the default internal mode', async () => {
    render(<HeadlessHost opts={{ editorMode: 'internal' }} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview').querySelector('textarea')).toBeTruthy();
    });
  });
});

/**
 * The same host with no `CodeHighlighter` above it — only a controller, which
 * is what `LiveDemoProvider` installs. Edits have to work through that alone.
 */
function ControllerOnlyHost() {
  const [code, setCode] = React.useState<ControlledCode | null>(null);
  const controller = React.useMemo(() => ({ code: code ?? undefined, setCode }), [code]);

  return (
    <CodeControllerContext.Provider value={controller}>
      <HeadlessBlock />
    </CodeControllerContext.Provider>
  );
}

describe('useCode headless editing without a highlighter', () => {
  it('accepts an edit through the controller alone', async () => {
    render(<ControllerOnlyHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    expect(editor.value).toBe(INITIAL_SOURCE);
    expect(screen.getByTestId('editable').textContent).toBe('true');

    await userEvent.click(editor);
    await userEvent.fill(editor, INITIAL_SOURCE.replace('<div />', '<span />'));

    await waitFor(() => {
      expect(screen.getByTestId('preview').textContent).toContain('<span />');
    });
  });

  it('keeps the variants the reader has not edited', async () => {
    render(<ControllerOnlyHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    await userEvent.click(editor);
    await userEvent.fill(editor, 'edited');

    // The controlled code holds only the edited variant; merging it over the
    // build-time map is what keeps the file selectable at all.
    await waitFor(() => {
      expect(screen.getByTestId('original-name').textContent).toBe(FILE_NAME);
    });
  });
});

describe('useCode headless projected editing', () => {
  it('patches an edited slice back into the complete source', async () => {
    render(<ProjectedHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    expect(editor.value).toBe(PROJECTED_SLICE);

    await userEvent.click(editor);
    await userEvent.fill(editor, '<span />');

    await waitFor(() => {
      expect(screen.getByTestId('full').textContent).toBe(
        INITIAL_SOURCE.replace(PROJECTED_SLICE, '<span />'),
      );
    });
  });

  it('keeps the projection aligned across successive edits', async () => {
    render(<ProjectedHost />);

    const editor = screen.getByLabelText('host editor') as HTMLTextAreaElement;
    await userEvent.click(editor);
    await userEvent.fill(editor, '<section />');
    await waitFor(() => expect(editor.value).toBe('<section />'));
    // A second edit must splice at the moved end, not the original one.
    await userEvent.fill(editor, '<p />');

    await waitFor(() => {
      expect(screen.getByTestId('full').textContent).toBe(
        INITIAL_SOURCE.replace(PROJECTED_SLICE, '<p />'),
      );
    });
  });
});
