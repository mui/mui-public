import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { HastRoot, ParseSource, SourceComments } from '../CodeHighlighter/types';
import { createParseSource } from '../pipeline/parseSource';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { createFocusedSourceProjection } from '../pipeline/loadIsomorphicCodeVariant/createEditableSourceProjection';
import { Pre } from './Pre';
import { preloadCodeEditor } from './codeEditorCache';

const FILE_NAME = 'CheckboxBasic.tsx';

const INITIAL_SOURCE = [
  "import * as React from 'react';",
  '',
  'export default function CheckboxBasic() {',
  '  return <div />;',
  '}',
].join('\n');

const HIGHLIGHT_COMMENTS: SourceComments = {
  3: ['@highlight-start'],
  4: ['@highlight-end'],
};

/** Focuses the function body, so the collapsed window hides the import. */
const FOCUS_COMMENTS: SourceComments = {
  4: ['@focus'],
};

let parseSource: ParseSource;

beforeAll(async () => {
  parseSource = await createParseSource();
  // `<Pre>`'s editable path loads the editor on demand; warm it so editable
  // renders below mount the textarea synchronously (within `act`).
  await preloadCodeEditor();
});

function createHighlightedSource(source: string): HastRoot {
  const root = parseSource(source, FILE_NAME);
  return enhanceCodeEmphasis(root, HIGHLIGHT_COMMENTS, FILE_NAME) as HastRoot;
}

/**
 * Mirrors what a host does: re-parse the edited source and feed it back as the
 * painted tree. Without this the `<pre>` can never follow an edit, since the
 * editor itself paints nothing.
 */
function EditablePreview({ onSource }: { onSource: (text: string) => void }) {
  const [source, setSource] = React.useState(INITIAL_SOURCE);
  const highlighted = React.useMemo(() => createHighlightedSource(source), [source]);

  return (
    <Pre
      fileName={FILE_NAME}
      language="tsx"
      shouldHighlight
      setSource={(text) => {
        onSource(text);
        setSource(text);
      }}
    >
      {highlighted}
    </Pre>
  );
}

function renderEditable(onSource: (text: string) => void = () => {}) {
  return render(<EditablePreview onSource={onSource} />);
}

/**
 * A collapsed block whose focused window is projected into the editor, so the
 * edit happens in place instead of expanding the block first.
 */
function ProjectedPreview({ onSource }: { onSource: (text: string) => void }) {
  const [source, setSource] = React.useState(INITIAL_SOURCE);
  const [expanded, setExpanded] = React.useState(false);
  const highlighted = React.useMemo(
    () =>
      enhanceCodeEmphasis(parseSource(source, FILE_NAME), FOCUS_COMMENTS, FILE_NAME) as HastRoot,
    [source],
  );
  const projection = React.useMemo(
    () => createFocusedSourceProjection(source, highlighted),
    [source, highlighted],
  );

  return (
    <React.Fragment>
      <span data-testid="expanded">{String(expanded)}</span>
      <Pre
        fileName={FILE_NAME}
        language="tsx"
        shouldHighlight
        expanded={expanded}
        expand={() => setExpanded(true)}
        sourceProjection={projection}
        setSource={(text) => {
          onSource(text);
          setSource(text);
        }}
      >
        {highlighted}
      </Pre>
    </React.Fragment>
  );
}

function getTextarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** Cmd on Apple platforms, Ctrl elsewhere — undo is modifier-sensitive. */
const UNDO_MODIFIER = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

afterEach(cleanup);

describe('Pre editing', () => {
  it('mounts a textarea carrying the complete source', async () => {
    renderEditable(() => {});
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    expect(getTextarea().value).toBe(INITIAL_SOURCE);
  });

  it('reports typed text as complete source', async () => {
    let latest = '';
    renderEditable((text) => {
      latest = text;
    });
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    textarea.setSelectionRange(INITIAL_SOURCE.length, INITIAL_SOURCE.length);
    await userEvent.keyboard('//x');

    await waitFor(() => expect(latest).toBe(`${INITIAL_SOURCE}//x`));
  });

  it('keeps typed lines separate', async () => {
    let latest = '';
    renderEditable((text) => {
      latest = text;
    });
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    textarea.setSelectionRange(INITIAL_SOURCE.length, INITIAL_SOURCE.length);
    await userEvent.keyboard('{Enter}tail');

    await waitFor(() => expect(latest).toBe(`${INITIAL_SOURCE}\ntail`));
    expect(latest.split('\n')).toHaveLength(INITIAL_SOURCE.split('\n').length + 1);
  });

  it('indents with Tab and keeps the edit on the native undo stack', async () => {
    // The core reason indent goes through `execCommand('insertText')`. jsdom has
    // no `execCommand`, so this path only exists under a real browser.
    renderEditable();
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    await userEvent.keyboard('{Tab}');

    await waitFor(() => expect(textarea.value).toBe(`  ${INITIAL_SOURCE}`));

    await userEvent.keyboard(`{${UNDO_MODIFIER}>}z{/${UNDO_MODIFIER}}`);
    await waitFor(() => expect(textarea.value).toBe(INITIAL_SOURCE));
  });

  it('outdents with Shift+Tab', async () => {
    renderEditable(() => {});
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    // Line 4 is the indented `  return <div />;`.
    const lineStart = INITIAL_SOURCE.indexOf('  return');
    textarea.setSelectionRange(lineStart + 2, lineStart + 2);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');

    await waitFor(() => expect(textarea.value).toContain('\nreturn <div />;'));
  });

  it('moves focus into the textarea on Enter and back out on Escape', async () => {
    renderEditable(() => {});
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const wrapper = screen.getByRole('group', { name: 'Editable code' });
    wrapper.focus();
    expect(document.activeElement).toBe(wrapper);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(getTextarea()));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(wrapper));
  });

  it('keeps the painted layer in step with the typed text', async () => {
    renderEditable(() => {});
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    textarea.setSelectionRange(INITIAL_SOURCE.length, INITIAL_SOURCE.length);
    await userEvent.keyboard('{Enter}const tail = 1;');

    // Read the `<code>` element, not the `<pre>`: the textarea overlays the pre
    // from inside it, so the pre's subtree is not a clean view of the source.
    const painted = document.querySelector('.editable-code-wrapper code')!;
    await waitFor(() => expect(painted.textContent).toContain('const tail = 1;'));
    // Highlighting still applies to the edited text, and frames survive editing.
    await waitFor(() => expect(painted.querySelector('[class*="pl-"]')).not.toBeNull());
    expect(painted.querySelector('span.frame')).not.toBeNull();
  });

  it('edits a collapsed block through its projection, without expanding', async () => {
    let latest = '';
    render(
      <ProjectedPreview
        onSource={(text) => {
          latest = text;
        }}
      />,
    );
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    // The textarea holds only the focused window, not the whole file.
    expect(textarea.value).toBe('return <div />;');

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await userEvent.keyboard(' // edited');

    // The edit goes out as the complete source, with the hidden indentation
    // restored, and the block stays collapsed.
    await waitFor(() =>
      expect(latest).toBe(INITIAL_SOURCE.replace('<div />;', '<div />; // edited')),
    );
    expect(screen.getByTestId('expanded').textContent).toBe('false');
  });

  it('does not mount a textarea for a read-only block', () => {
    render(
      <Pre fileName={FILE_NAME} language="tsx" shouldHighlight>
        {createHighlightedSource(INITIAL_SOURCE)}
      </Pre>,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
