import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { HastRoot, ParseSource, SourceComments } from '../CodeHighlighter/types';
import { createParseSource } from '../pipeline/parseSource';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { Pre } from './Pre';
import { preloadEditableEngine } from './useEditable';

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
  // `<Pre>`'s editable path loads its editing engine on demand; warm it so
  // editable renders below attach contentEditable synchronously (within `act`).
  await preloadEditableEngine();
});

function createHighlightedSource(source: string): HastRoot {
  const root = parseSource(source, FILE_NAME);
  return enhanceCodeEmphasis(root, HIGHLIGHT_COMMENTS, FILE_NAME) as HastRoot;
}

/**
 * Places the caret at a given character offset inside `element` and waits
 * for one animation frame. `useEditable` captures its internal
 * `state.position` from a `focus` listener via `requestAnimationFrame`,
 * so synthesized keystrokes fired immediately after caret placement
 * otherwise operate on the stale default `{line:0, column:0}`. Awaiting
 * one frame here makes tests order-independent.
 */
async function placeCaret(element: HTMLElement, offset: number) {
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
      break;
    }

    current += length;
    node = walker.nextNode();
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * `<Pre>` only hast-renders frames that the `IntersectionObserver` has
 * marked visible (an optimization for large code blocks). The browser
 * tests rely on every line having a `[data-ln]` span for caret math, so
 * wait until the observer has hydrated all frames before driving input.
 */
async function waitForFramesHydrated(pre: HTMLPreElement) {
  await waitFor(() => {
    const frames = pre.querySelectorAll('.frame');
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((frame) => {
      expect(frame.getAttribute('data-lined')).not.toBeNull();
    });
  });
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
  // RTL's auto-cleanup is only wired up when the test framework exposes
  // `globalThis.afterEach`. Vitest's browser runner doesn't, so we clean
  // up explicitly to keep prior renders from pushing later tests' `<pre>`
  // out of the viewport (which would prevent the IntersectionObserver
  // from hydrating their frames).
  afterEach(() => {
    cleanup();
  });

  it('keeps the </p> line and following </div> line separate after typing and rerender', async () => {
    render(<EditablePreview />);
    const pre = screen.getByText('Type Whatever You Want Below', { exact: false }).closest('pre');

    expect(pre).not.toBeNull();
    await waitForFramesHydrated(pre as HTMLPreElement);

    const lines = INITIAL_SOURCE.split('\n');
    let offset = 0;
    for (let i = 0; i < 7; i += 1) {
      offset += lines[i].length + 1;
    }
    offset += lines[7].length;

    await placeCaret(pre!, offset);
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

  it('keeps lines separate when typing two characters after </p> (Firefox repro)', async () => {
    const { container } = render(<EditablePreview />);
    const pre = container.querySelector('pre')!;

    expect(pre).not.toBeNull();
    await waitForFramesHydrated(pre);

    const lines = INITIAL_SOURCE.split('\n');
    let offset = 0;
    for (let i = 0; i < 7; i += 1) {
      offset += lines[i].length + 1;
    }
    offset += lines[7].length;

    await placeCaret(pre!, offset);

    // Type two characters with overlapping keydowns. The key events fire as:
    // a-down, b-down, a-up, b-up — which means the second keydown arrives
    // before React has rerendered from the first edit. Without correct
    // pendingContent tracking, Firefox merges the </p> line into the
    // following </div> line during the second keystroke (line 8 ends up as
    // "...</p>ab    </div>" and line 9 shifts up to "  );").
    await userEvent.keyboard('{a>}{b>}{/a}{/b}');

    await waitFor(() => {
      const currentPre = container.querySelector('pre')!;
      const highlightedLine = currentPre.querySelector('[data-ln="8"]');
      const nextLine = currentPre.querySelector('[data-ln="9"]');

      expect(highlightedLine).not.toBeNull();
      expect(nextLine).not.toBeNull();
      expect((highlightedLine as HTMLElement).textContent).toContain('</p>ab');
      expect((highlightedLine as HTMLElement).textContent).not.toContain('</div>');
      expect((nextLine as HTMLElement).textContent).toBe('    </div>');
    });
  });

  it('edits correctly when surrounding frames are not hast-rendered (mixed visibility)', async () => {
    // Build a tall source with two well-separated highlight regions and a
    // long non-emphasised middle. The middle frame is `'normal'` (not in
    // `INITIAL_VISIBLE_FRAME_TYPES`), so it starts as plain text and only
    // hydrates if the `IntersectionObserver` reports it as visible. Most
    // viewports won't reach the bottom highlight either, leaving it
    // un-hydrated. We verify editing in a hydrated frame still produces a
    // correct full-source update — i.e. the plain-text frames flow through
    // `element.textContent` unchanged.
    const middleFiller = Array.from(
      { length: 80 },
      (_unused, index) => `  // filler line ${index + 1}`,
    ).join('\n');
    const longSource = [
      "import * as React from 'react';",
      '',
      'export default function TallDemo() {',
      "  const top = 'top';",
      "  const middle = 'middle';",
      '',
      middleFiller,
      '',
      "  const bottom = 'bottom';",
      '  return null;',
      '}',
    ].join('\n');

    // Highlight one line near the top and one line near the bottom so the
    // hast splits into: normal · highlighted · normal · highlighted · normal.
    const totalLines = longSource.split('\n').length;
    const longComments: SourceComments = {
      4: ['@highlight'],
      [totalLines - 2]: ['@highlight'],
    };

    function TallEditablePreview() {
      const [source, setSource] = React.useState(longSource);
      const [captured, setCaptured] = React.useState<string | null>(null);
      const highlightedSource = React.useMemo(() => {
        const root = parseSource(source, FILE_NAME);
        return enhanceCodeEmphasis(root, longComments, FILE_NAME) as HastRoot;
      }, [source]);

      // Expose the most-recent captured source via a data attribute so the
      // test can read it without reaching into React internals.
      return (
        <div data-captured-source={captured ?? source}>
          <Pre
            fileName={FILE_NAME}
            language="tsx"
            setSource={(nextSource) => {
              setCaptured(nextSource);
              setSource(nextSource);
            }}
            shouldHighlight
          >
            {highlightedSource}
          </Pre>
        </div>
      );
    }

    const { container } = render(<TallEditablePreview />);
    const pre = container.querySelector('pre')!;
    expect(pre).not.toBeNull();

    // Wait until at least one frame is hydrated AND at least one frame is
    // not — the mixed state we want to exercise. The IO callback runs on
    // the next animation frame after observation, so this resolves quickly
    // in real browsers.
    await waitFor(() => {
      const frames = Array.from(pre.querySelectorAll('.frame'));
      expect(frames.length).toBeGreaterThanOrEqual(3);
      const hydrated = frames.filter((frame) => frame.getAttribute('data-lined') !== null);
      const plainText = frames.filter((frame) => frame.getAttribute('data-lined') === null);
      expect(hydrated.length).toBeGreaterThan(0);
      expect(plainText.length).toBeGreaterThan(0);
    });

    // Find the first hydrated `.line` (it should belong to the top
    // highlighted frame, which is in viewport) and place the caret at its
    // end so the next keystroke appends to it.
    const firstHydratedLine = pre.querySelector('[data-ln]') as HTMLElement | null;
    expect(firstHydratedLine).not.toBeNull();
    const lineNumber = Number(firstHydratedLine!.getAttribute('data-ln'));
    expect(Number.isFinite(lineNumber)).toBe(true);

    // Compute global offset to the end of that line in the source.
    const sourceLines = longSource.split('\n');
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i += 1) {
      offset += sourceLines[i].length + 1;
    }
    offset += sourceLines[lineNumber - 1].length;

    await placeCaret(pre, offset);
    await userEvent.keyboard('Z');

    // After the edit, `setSource` must have received the complete source
    // (including the long plain-text middle and the un-hydrated bottom
    // highlight) with `Z` appended to the targeted line. `useEditable`
    // normalises the captured text to always end with a newline.
    await waitFor(() => {
      const wrapper = container.firstElementChild as HTMLElement;
      const captured = wrapper.getAttribute('data-captured-source');
      expect(captured).not.toBeNull();
      const expectedLines = longSource.split('\n');
      expectedLines[lineNumber - 1] = `${expectedLines[lineNumber - 1]}Z`;
      const expected = `${expectedLines.join('\n')}\n`;
      expect(captured).toBe(expected);
    });

    // Sanity-check: at least one frame is still rendered as plain text
    // after the edit, confirming the optimization isn't bypassed by
    // re-rendering.
    const framesAfter = Array.from(pre.querySelectorAll('.frame'));
    const plainTextAfter = framesAfter.filter((frame) => frame.getAttribute('data-lined') === null);
    expect(plainTextAfter.length).toBeGreaterThan(0);
  });

  it('does not collapse lines when deleting and re-typing the > in <div>', async () => {
    const { container } = render(<EditablePreview />);
    const pre = container.querySelector('pre')!;
    expect(pre).not.toBeNull();
    await waitForFramesHydrated(pre);

    // Place caret at the end of line 6: "    <div>"
    const lines = INITIAL_SOURCE.split('\n');
    let offset = 0;
    for (let i = 0; i < 5; i += 1) {
      offset += lines[i].length + 1;
    }
    offset += lines[5].length; // end of "    <div>"

    await placeCaret(pre!, offset);

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
