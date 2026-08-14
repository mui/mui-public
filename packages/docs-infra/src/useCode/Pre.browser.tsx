import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { HastRoot, ParseSource, SourceComments } from '../CodeHighlighter/types';
import { createParseSource } from '../pipeline/parseSource';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
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

function renderEditable(onSource: (text: string) => void) {
  return render(
    <Pre fileName={FILE_NAME} language="tsx" shouldHighlight setSource={(text) => onSource(text)}>
      {createHighlightedSource(INITIAL_SOURCE)}
    </Pre>,
  );
}

function getTextarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

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
    let latest = '';
    renderEditable((text) => {
      latest = text;
    });
    await waitFor(() => expect(getTextarea()).toBeTruthy());

    const textarea = getTextarea();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    await userEvent.keyboard('{Tab}');

    await waitFor(() => expect(textarea.value).toBe(`  ${INITIAL_SOURCE}`));

    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(textarea.value).toBe(INITIAL_SOURCE));
    expect(latest).toBe(INITIAL_SOURCE);
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
    await userEvent.keyboard('\nconst tail = 1;');

    const painted = document.querySelector('pre[aria-hidden="true"]')!;
    await waitFor(() => expect(painted.textContent).toContain('const tail = 1;'));
    // Highlighting still applies to the edited text.
    await waitFor(() => expect(painted.querySelector('[class*="pl-"]')).not.toBeNull());
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
