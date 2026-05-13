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

// Test-scoped hook: when set, controls the intersection rect the mock IO
// reports for each observed element. Returning a zero-area rect simulates a
// frame hidden by a CSS collapse (`max-height: 0`, `visibility: hidden`).
let mockIntersectionRect: ((target: Element) => DOMRectInit) | null = null;

beforeAll(async () => {
  class MockIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      // JSDOM's `getBoundingClientRect()` returns a zero-sized rect, but
      // `<Pre>` now treats a zero-area intersection rect as "not visible"
      // (mirrors how browsers report collapsed/`visibility:hidden`
      // frames). Default to a non-zero rect so the mock represents an
      // actually visible frame; tests can override per-target via
      // `mockIntersectionRect`.
      const init = mockIntersectionRect?.(target) ?? {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
      };
      const rect = init as DOMRectReadOnly;
      // Always report `isIntersecting: true` regardless of rect area —
      // this mirrors real browsers, which compute `isIntersecting` from
      // the target's geometric position relative to the root and happily
      // report `true` for elements whose layout box has collapsed to zero
      // area (e.g. `max-height: 0; overflow: hidden;` or
      // `visibility: hidden`). The whole point of `<Pre>`'s zero-area
      // guard is to reject those.
      const hasArea = (rect.width ?? 0) > 0 && (rect.height ?? 0) > 0;
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            // Real browsers report ratio 0 for zero-area targets even
            // when `isIntersecting` is true; keep the mock consistent.
            intersectionRatio: hasArea ? 1 : 0,
            boundingClientRect: rect,
            intersectionRect: rect,
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

  it('does not hydrate frames whose intersection rect has zero area (CSS-collapsed)', async () => {
    // Simulate the hidden-when-collapsed state: highlighted frames have a
    // visible rect, but the surrounding `normal` frames are clipped to
    // zero height by the host's collapse CSS. The browser still reports
    // them to IntersectionObserver based on their geometric position;
    // `<Pre>` should treat the zero-area intersection as "not visible"
    // and leave them as plain text instead of hydrating them to
    // highlighted HAST.
    mockIntersectionRect = (target) => {
      const frameType = target.getAttribute('data-frame-type');
      if (frameType === 'highlighted') {
        return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 };
      }
      // Collapsed frames: in viewport position-wise, but zero-area.
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };

    try {
      const { container } = render(<EditablePreview />);
      // Inspecting internal frame elements (`.frame` / `data-frame-type`),
      // not user-facing roles, so reach in via the container.
      // eslint-disable-next-line testing-library/no-container
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();

      await waitFor(() => {
        const frames = Array.from(pre!.querySelectorAll('.frame'));
        expect(frames.length).toBeGreaterThan(0);
      });

      const frames = Array.from(pre!.querySelectorAll('.frame'));
      const highlightedFrames = frames.filter(
        (frame) => frame.getAttribute('data-frame-type') === 'highlighted',
      );
      const collapsedFrames = frames.filter(
        (frame) => frame.getAttribute('data-frame-type') !== 'highlighted',
      );

      expect(highlightedFrames.length).toBeGreaterThan(0);
      expect(collapsedFrames.length).toBeGreaterThan(0);

      // Highlighted (visible) frames should be hydrated.
      highlightedFrames.forEach((frame) => {
        expect(frame.getAttribute('data-lined')).not.toBeNull();
      });
      // Collapsed (zero-area) frames should remain plain text.
      collapsedFrames.forEach((frame) => {
        expect(frame.getAttribute('data-lined')).toBeNull();
      });
    } finally {
      mockIntersectionRect = null;
    }
  });
});
