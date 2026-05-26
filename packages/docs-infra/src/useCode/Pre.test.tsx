/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
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

// Per-test instrumentation for the IO mock. When set, `observe` and
// `unobserve` calls are recorded so tests can assert re-observe behavior
// without depending on internal observer references.
let observeCalls: Element[] | null = null;
let unobserveCalls: Element[] | null = null;

// Per-test capture of constructed ResizeObserver instances so tests can
// trigger their callbacks manually (JSDOM doesn't actually compute layout).
let resizeObserverInstances: Array<{
  callback: ResizeObserverCallback;
  observed: Element[];
}> | null = null;

beforeAll(async () => {
  class MockIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      observeCalls?.push(target);
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

    unobserve(target: Element) {
      unobserveCalls?.push(target);
    }

    disconnect() {}

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;

  class MockResizeObserver {
    private readonly observed: Element[] = [];

    constructor(callback: ResizeObserverCallback) {
      resizeObserverInstances?.push({ callback, observed: this.observed });
    }

    observe(target: Element) {
      this.observed.push(target);
    }

    unobserve() {}

    disconnect() {}
  }

  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

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
  // Tests share module-level state (the per-test mock hooks above and
  // `<Pre>`'s own module-level toggle subscriber registry). Reset
  // everything between tests so a future test that throws synchronously
  // — or simply forgets explicit cleanup — can't leak hooks/subscribers
  // into the next one. RTL's auto-cleanup is a no-op here because the
  // root vitest config does not set `globals: true`.
  afterEach(() => {
    cleanup();
    mockIntersectionRect = null;
    observeCalls = null;
    unobserveCalls = null;
    resizeObserverInstances = null;
  });

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
  });

  it('shares a single document `toggle` listener across mounted <Pre> instances', () => {
    // Belt-and-suspenders: this test has tight numeric invariants on
    // subscriber accounting (`toHaveLength(1)` etc.) and `<Pre>`'s
    // `<details>` toggle subscriber registry lives at module scope, so
    // any leaked mount from a prior test (e.g. one that threw before
    // the global `afterEach` ran) would already have a listener
    // attached and our new mount would be a no-op for the spy.
    cleanup();

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    try {
      const { unmount: unmountFirst } = render(<EditablePreview />);
      const toggleAddsAfterFirst = addSpy.mock.calls.filter(
        ([eventName]) => eventName === 'toggle',
      );
      expect(toggleAddsAfterFirst).toHaveLength(1);

      const { unmount: unmountSecond } = render(<EditablePreview />);
      // Mounting a second `<Pre>` must reuse the existing capture-phase
      // listener rather than installing a per-instance one.
      const toggleAddsAfterSecond = addSpy.mock.calls.filter(
        ([eventName]) => eventName === 'toggle',
      );
      expect(toggleAddsAfterSecond).toHaveLength(1);

      unmountFirst();
      // One subscriber still active → listener must remain attached.
      const toggleRemovesAfterFirstUnmount = removeSpy.mock.calls.filter(
        ([eventName]) => eventName === 'toggle',
      );
      expect(toggleRemovesAfterFirstUnmount).toHaveLength(0);

      unmountSecond();
      // Last subscriber gone → shared listener must be detached.
      const toggleRemovesAfterAllUnmount = removeSpy.mock.calls.filter(
        ([eventName]) => eventName === 'toggle',
      );
      expect(toggleRemovesAfterAllUnmount).toHaveLength(1);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('re-observes every frame when the <pre> ResizeObserver fires', async () => {
    resizeObserverInstances = [];
    observeCalls = [];
    unobserveCalls = [];

    const { container } = render(<EditablePreview />);
    // eslint-disable-next-line testing-library/no-container
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();

    await waitFor(() => {
      expect(pre!.querySelectorAll('.frame').length).toBeGreaterThan(0);
    });

    const frames = Array.from(pre!.querySelectorAll('.frame'));
    // Sanity: every frame was observed at least once during initial mount.
    frames.forEach((frame) => {
      expect(observeCalls).toContain(frame);
    });

    // The Pre installs exactly one RO (on the <pre> itself).
    expect(resizeObserverInstances).toHaveLength(1);
    expect(resizeObserverInstances![0].observed).toEqual([pre]);

    // Reset counters so we can assert *re-observe* behavior in isolation.
    observeCalls!.length = 0;
    unobserveCalls!.length = 0;

    // Trigger the RO callback as a real browser would after a layout
    // change (e.g. CSS-driven collapse animation).
    resizeObserverInstances![0].callback(
      [] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );

    // Each tracked frame must be unobserved+re-observed so the IO
    // re-evaluates its clipped/unclipped state without a synchronous
    // `getBoundingClientRect()` call.
    frames.forEach((frame) => {
      expect(unobserveCalls).toContain(frame);
      expect(observeCalls).toContain(frame);
    });
  });

  it('reflects `transforming` as the `data-transforming` attribute', () => {
    function Harness({ transforming }: { transforming: 'expand' | 'collapse' | null }) {
      const highlighted = React.useMemo(() => createHighlightedSource(INITIAL_SOURCE), []);
      return (
        <Pre fileName={FILE_NAME} language="tsx" shouldHighlight transforming={transforming}>
          {highlighted}
        </Pre>
      );
    }

    const { container, rerender } = render(<Harness transforming={null} />);
    // eslint-disable-next-line testing-library/no-container
    const pre = container.querySelector('pre')!;
    expect(pre).not.toBeNull();
    expect(pre.hasAttribute('data-transforming')).to.equal(false);

    // Pre-swap expand window (e.g. JS → null or JS → TS first half).
    rerender(<Harness transforming="expand" />);
    expect(pre.getAttribute('data-transforming')).to.equal('expand');

    // Commit clears the attribute.
    rerender(<Harness transforming={null} />);
    expect(pre.hasAttribute('data-transforming')).to.equal(false);

    // Post-swap collapse window (e.g. null → JS or JS → TS second half).
    rerender(<Harness transforming="collapse" />);
    expect(pre.getAttribute('data-transforming')).to.equal('collapse');

    rerender(<Harness transforming={null} />);
    expect(pre.hasAttribute('data-transforming')).to.equal(false);
  });

  describe('swapTarget bridge placeholder', () => {
    function SwapHarness({
      transforming,
      swapTarget,
      expanded,
    }: {
      transforming: 'expand' | 'collapse' | null;
      swapTarget: { focusedLines: number; totalLines: number } | null;
      expanded?: boolean;
    }) {
      const highlighted = React.useMemo(() => createHighlightedSource(INITIAL_SOURCE), []);
      return (
        <Pre
          fileName={FILE_NAME}
          language="tsx"
          shouldHighlight
          transforming={transforming}
          swapTarget={swapTarget}
          expanded={expanded}
        >
          {highlighted}
        </Pre>
      );
    }

    it('appends a `.collapse` bridge to the last frame when the partner is taller (expanded)', () => {
      // INITIAL_SOURCE has 11 totalLines; swap to a 15-line partner ⇒ delta=4.
      const { container } = render(
        <SwapHarness
          transforming="expand"
          swapTarget={{ focusedLines: 0, totalLines: 15 }}
          expanded
        />,
      );
      // eslint-disable-next-line testing-library/no-container
      const bridges = container.querySelectorAll('span.collapse[data-lines="4"]');
      expect(bridges.length).to.equal(1);
      // Each bridged line is its own empty `<span>` child so the host
      // CSS (which animates `.frame .collapse > span`) has something to
      // size and animate.
      expect(bridges[0].children.length).to.equal(4);
    });

    it('omits the bridge when the partner is shorter or equal', () => {
      const { container } = render(
        <SwapHarness
          transforming="expand"
          swapTarget={{ focusedLines: 0, totalLines: 11 }}
          expanded
        />,
      );
      // eslint-disable-next-line testing-library/no-container
      const bridges = container.querySelectorAll('span.collapse');
      expect(bridges.length).to.equal(0);
    });

    it('omits the bridge when `transforming` is null even with a swapTarget', () => {
      const { container } = render(
        <SwapHarness
          transforming={null}
          swapTarget={{ focusedLines: 0, totalLines: 50 }}
          expanded
        />,
      );
      // eslint-disable-next-line testing-library/no-container
      const bridges = container.querySelectorAll('span.collapse');
      expect(bridges.length).to.equal(0);
    });

    it('omits the bridge when `swapTarget` is null', () => {
      const { container } = render(
        <SwapHarness transforming="expand" swapTarget={null} expanded />,
      );
      // eslint-disable-next-line testing-library/no-container
      const bridges = container.querySelectorAll('span.collapse');
      expect(bridges.length).to.equal(0);
    });
  });
});
