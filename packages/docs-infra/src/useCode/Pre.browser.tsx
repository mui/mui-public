import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HastRoot, ParseSource, SourceComments } from '../CodeHighlighter/types';
import { createParseSource } from '../pipeline/parseSource';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { Pre } from './Pre';

const FILE_NAME = 'CheckboxBasic.tsx';

const INITIAL_SOURCE = [
  "import * as React from 'react';",
  "import { Checkbox } from '@/components/Checkbox';",
  '',
  'export default function CheckboxBasic() {',
  '  return (',
  '    <div>',
  '      <Checkbox defaultChecked />',
  "      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>",
  '    </div>',
  '  );',
  '}',
].join('\n');

const HIGHLIGHT_COMMENTS: SourceComments = {
  7: ['@highlight-start'],
  8: ['@highlight-end'],
};

let parseSource: ParseSource;

beforeAll(async () => {
  parseSource = await createParseSource();
});

function createHighlightedSource(source: string): HastRoot {
  const root = parseSource(source, FILE_NAME);
  return enhanceCodeEmphasis(root, HIGHLIGHT_COMMENTS, FILE_NAME) as HastRoot;
}

function placeCaret(element: HTMLElement, offset: number) {
  element.focus();
  const selection = window.getSelection()!;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = 0;
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (current + length >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - current);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    current += length;
    node = walker.nextNode();
  }
}

function EditablePreview() {
  const [source, setSource] = React.useState(INITIAL_SOURCE);
  const highlightedSource = React.useMemo(() => createHighlightedSource(source), [source]);

  return (
    <Pre
      fileName={FILE_NAME}
      language="tsx"
      setSource={(nextSource) => setSource(nextSource)}
      shouldHighlight
    >
      {highlightedSource}
    </Pre>
  );
}

describe('Pre - browser', () => {
  it('keeps the </p> line and following </div> line separate after typing and rerender', async () => {
    render(<EditablePreview />);
    const pre = screen.getByText('Type Whatever You Want Below', { exact: false }).closest('pre');

    expect(pre).not.toBeNull();

    const lines = INITIAL_SOURCE.split('\n');
    let offset = 0;
    for (let i = 0; i < 7; i += 1) {
      offset += lines[i].length + 1;
    }
    offset += lines[7].length;

    placeCaret(pre!, offset);
    await userEvent.keyboard('x');

    await waitFor(() => {
      const currentPre = screen
        .getByText('Type Whatever You Want Below', { exact: false })
        .closest('pre');
      const highlightedLine = currentPre?.querySelector('[data-ln="8"]');
      const nextLine = currentPre?.querySelector('[data-ln="9"]');

      expect(highlightedLine).not.toBeNull();
      expect(nextLine).not.toBeNull();
      expect((highlightedLine as HTMLElement).textContent).toContain('</p>x');
      expect((highlightedLine as HTMLElement).textContent).not.toContain('</div>');
      expect((nextLine as HTMLElement).textContent).toBe('    </div>');
    });
  });

  it('does not collapse lines when deleting and re-typing the > in <div>', async () => {
    const { container } = render(<EditablePreview />);
    const pre = container.querySelector('pre')!;
    expect(pre).not.toBeNull();

    // Place caret at the end of line 6: "    <div>"
    const lines = INITIAL_SOURCE.split('\n');
    let offset = 0;
    for (let i = 0; i < 5; i += 1) {
      offset += lines[i].length + 1;
    }
    offset += lines[5].length; // end of "    <div>"

    placeCaret(pre!, offset);

    // Delete the '>' and immediately re-type it without waiting for re-render
    await userEvent.keyboard('{Backspace}>');

    // Verify lines are not collapsed after the final re-render
    await waitFor(() => {
      const currentPre = container.querySelector('pre')!;
      const line6 = currentPre.querySelector('[data-ln="6"]');
      const line7 = currentPre.querySelector('[data-ln="7"]');
      const line9 = currentPre.querySelector('[data-ln="9"]');

      expect(line6).not.toBeNull();
      expect(line7).not.toBeNull();
      expect(line9).not.toBeNull();
      expect((line6 as HTMLElement).textContent).toContain('<div>');
      expect((line6 as HTMLElement).textContent).not.toContain('<Checkbox');
      expect((line9 as HTMLElement).textContent).toContain('</div>');
    });
  });
});
