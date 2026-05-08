/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  class MockIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    }

    unobserve() {}

    disconnect() {}

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
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

function insertPlaintextCharacter(element: HTMLElement, key: string) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    }),
  );

  const selection = window.getSelection()!;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(key);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  element.dispatchEvent(
    new KeyboardEvent('keyup', {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    }),
  );
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

describe('Pre', () => {
  it('keeps the </p> line and following </div> line separate after rerender', async () => {
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
    insertPlaintextCharacter(pre!, 'x');

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
});
