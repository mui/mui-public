/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import type {
  HastRoot,
  ParseSource,
  SourceComments,
  VariantSource,
} from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import * as fallbackFormatModule from '../CodeHighlighter/fallbackFormat';
import * as decodeHastSourceModule from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { createParseSource } from '../pipeline/parseSource';
import { enhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { Pre } from './Pre';
import { CodeContext } from '../CodeProvider/CodeContext';

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

const getFrameTypes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span.frame'), (frame) =>
    frame.getAttribute('data-frame-type'),
  );

function ReadOnlyPreview() {
  const highlightedSource = React.useMemo(() => createHighlightedSource(INITIAL_SOURCE), []);

  return (
    <Pre fileName={FILE_NAME} language="tsx" shouldHighlight>
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

    const { container } = render(<ReadOnlyPreview />);
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
      const { unmount: unmountFirst } = render(<ReadOnlyPreview />);
      const toggleAddsAfterFirst = addSpy.mock.calls.filter(
        ([eventName]) => eventName === 'toggle',
      );
      expect(toggleAddsAfterFirst).toHaveLength(1);

      const { unmount: unmountSecond } = render(<ReadOnlyPreview />);
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

    const { container } = render(<ReadOnlyPreview />);
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

  it('does not load the editor for a read-only block', () => {
    const codeEditorLoader = vi.fn(() => import('./CodeEditor'));

    render(
      <CodeContext.Provider value={{ codeEditorLoader }}>
        <Pre fileName="App.tsx">{'const value = 1;'}</Pre>
      </CodeContext.Provider>,
    );

    expect(codeEditorLoader).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('defers an interaction editor load until pointer engagement', async () => {
    const codeEditorLoader = vi.fn(() => import('./CodeEditor'));
    const { container } = render(
      <CodeContext.Provider value={{ codeEditorLoader }}>
        <Pre fileName="App.tsx" setSource={() => {}} editActivation="interaction">
          {'const value = 1;'}
        </Pre>
      </CodeContext.Provider>,
    );

    expect(codeEditorLoader).not.toHaveBeenCalled();
    // eslint-disable-next-line testing-library/no-container -- the read-only fallback is intentionally hidden from roles after engagement
    fireEvent.pointerDown(container.querySelector('pre')!);

    await waitFor(() => expect(codeEditorLoader).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('textbox')).toBeInstanceOf(HTMLTextAreaElement);
  });

  describe('collapseToEmpty', () => {
    function ForcedHarness({
      collapseToEmpty,
      expanded,
    }: {
      collapseToEmpty?: boolean;
      expanded?: boolean;
    }) {
      const highlightedSource = React.useMemo(() => createHighlightedSource(INITIAL_SOURCE), []);
      return (
        <Pre
          fileName={FILE_NAME}
          language="tsx"
          shouldHighlight
          collapseToEmpty={collapseToEmpty}
          expanded={expanded}
        >
          {highlightedSource}
        </Pre>
      );
    }

    it('keeps the highlighted frame and a non-zero focused count when not forced', () => {
      // Control: lines 7-8 are highlighted, so a `highlighted` frame exists and
      // the block reports a non-empty focused window.
      const { container } = render(<ForcedHarness />);
      // eslint-disable-next-line testing-library/no-container
      const highlighted = container.querySelectorAll('span.frame[data-frame-type="highlighted"]');
      expect(highlighted.length).toBeGreaterThan(0);
      // eslint-disable-next-line testing-library/no-container
      const code = container.querySelector('code')!;
      expect(code.getAttribute('data-focused-lines')).not.toBe('0');
    });

    it('demotes focus/highlighted frames, forces collapsible, and reports 0 focused lines', () => {
      const { container } = render(<ForcedHarness collapseToEmpty />);
      /* eslint-disable testing-library/no-container -- inspecting internal `.frame` elements / `data-frame-type`, which Testing Library queries don't expose. */
      const countFramesOfType = (type: string) =>
        container.querySelectorAll(`span.frame[data-frame-type="${type}"]`).length;

      // No collapsed-visible frame type remains in the rendered output.
      for (const type of ['highlighted', 'focus', 'padding-top', 'padding-bottom']) {
        expect(countFramesOfType(type)).toBe(0);
      }
      // Padding frames resolve to normal under collapse-to-empty, but normal frames
      // must render with no `data-frame-type` attribute.
      expect(countFramesOfType('normal')).toBe(0);
      // The highlighted frame is demoted to its hidden variant.
      expect(countFramesOfType('highlighted-unfocused')).toBeGreaterThan(0);

      // The block is forced collapsible so it can still be expanded.
      expect(container.querySelector('code')!.hasAttribute('data-collapsible')).toBe(true);

      // The collapsed window is empty.
      expect(container.querySelector('code')!.getAttribute('data-focused-lines')).toBe('0');
      /* eslint-enable testing-library/no-container */
    });

    it('keeps demoted frame attributes stable when expanded changes', () => {
      const { container, rerender } = render(<ForcedHarness collapseToEmpty />);
      const collapsedFrameTypes = getFrameTypes(container);

      rerender(<ForcedHarness collapseToEmpty expanded />);

      expect(getFrameTypes(container)).toEqual(collapsedFrameTypes);
      /* eslint-disable testing-library/no-container -- inspecting internal `.frame` elements / `data-frame-type`, which Testing Library queries don't expose. */
      expect(container.querySelectorAll('span.frame[data-frame-type="highlighted"]')).toHaveLength(
        0,
      );
      expect(container.querySelectorAll('span.frame[data-frame-type="focus"]')).toHaveLength(0);
      /* eslint-enable testing-library/no-container */
    });
  });

  describe('deferred string fallbacks', () => {
    it('uses fallback metadata to mark a string source collapsible before HAST exists', () => {
      const fallback: FallbackNode[] = [
        ['span', 'frame', { dataFrameType: 'focus' }, 'const visible = true;'],
        ['span', 'frame', {}, '\nconst hidden = true;'],
      ];

      const { container } = render(
        <Pre
          fileName={FILE_NAME}
          language="tsx"
          fallback={fallback}
          fallbackLineCounts={{ totalLines: 40, focusedLines: 12, collapsible: true }}
        >
          {'const visible = true;\nconst hidden = true;'}
        </Pre>,
      );

      // eslint-disable-next-line testing-library/no-container
      const code = container.querySelector('code')!;
      expect(code.hasAttribute('data-collapsible')).toBe(true);
      expect(code.getAttribute('data-total-lines')).toBe('40');
      expect(code.getAttribute('data-focused-lines')).toBe('12');
    });

    it('demotes string fallback frames when collapseToEmpty is active', () => {
      const fallback: FallbackNode[] = [
        ['span', 'frame', { dataFrameType: 'focus' }, 'const visible = true;'],
        ['span', 'frame', {}, '\nconst hidden = true;'],
      ];
      const text = 'const visible = true;\nconst hidden = true;';

      const { container, rerender } = render(
        <Pre
          fileName={FILE_NAME}
          language="tsx"
          fallback={fallback}
          fallbackLineCounts={{ totalLines: 40, focusedLines: 12, collapsible: true }}
          collapseToEmpty
        >
          {text}
        </Pre>,
      );

      /* eslint-disable testing-library/no-container -- inspecting internal fallback frame attributes. */
      expect(container.querySelectorAll('span.frame[data-frame-type="focus"]')).toHaveLength(0);
      expect(
        container.querySelectorAll('span.frame[data-frame-type="focus-unfocused"]'),
      ).toHaveLength(1);
      const code = container.querySelector('code')!;
      expect(code.hasAttribute('data-collapsible')).toBe(true);
      expect(code.getAttribute('data-focused-lines')).toBe('0');

      const collapsedFrameTypes = getFrameTypes(container);
      rerender(
        <Pre
          fileName={FILE_NAME}
          language="tsx"
          fallback={fallback}
          fallbackLineCounts={{ totalLines: 40, focusedLines: 12, collapsible: true }}
          collapseToEmpty
          expanded
        >
          {text}
        </Pre>,
      );

      expect(getFrameTypes(container)).toEqual(collapsedFrameTypes);
      expect(container.querySelectorAll('span.frame[data-frame-type="focus"]')).toHaveLength(0);
      expect(
        container.querySelectorAll('span.frame[data-frame-type="focus-unfocused"]'),
      ).toHaveLength(1);
      /* eslint-enable testing-library/no-container */
    });
  });
});

describe('Pre decode latch (highlightAfter: init)', () => {
  // A live HAST source that decodes to `DECODED`, paired with a fallback that
  // renders `FALLBACK`, so we can tell which one painted and in what order.
  const decodedSource = {
    type: 'root',
    children: [{ type: 'text', value: 'DECODED' }],
  } as unknown as VariantSource;
  // The plain fallback (every non-init mode, and `init` under collapse-to-empty) — a frame
  // whose only child is a text string.
  const plainFallback: FallbackNode[] = [['span', 'frame', { dataFrameType: 'focus' }, 'FALLBACK']];
  // The promoted highlighted-visible fallback `highlightAfter: 'init'` ships — the frame keeps
  // nested token spans, so `fallbackIsHighlighted` is true and the latch engages.
  const highlightedFallback: FallbackNode[] = [
    ['span', 'frame', { dataFrameType: 'focus' }, [['span', 'pl-k', 'FALLBACK']]],
  ];
  const counts = { totalLines: 1, focusedLines: 1, collapsible: false };

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders the fallback first and defers the decompressing decode (init, highlighted fallback)', () => {
    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    const fallbackSpy = vi.spyOn(fallbackFormatModule, 'fallbackToHast');
    render(
      <Pre shouldHighlight fallback={highlightedFallback} fallbackLineCounts={counts}>
        {decodedSource}
      </Pre>,
    );
    // The fallback render runs before the decode: the highlighted fallback paints
    // first, then the decode lands on a later (post-effect) render.
    expect(fallbackSpy.mock.invocationCallOrder[0]).toBeLessThan(
      decodeSpy.mock.invocationCallOrder[0],
    );
    // The decode does eventually run and the full tree replaces the fallback.
    expect(screen.getByText('DECODED')).toBeTruthy();
  });

  it('decodes on mount (no flash) when shouldHighlight is true but the fallback is PLAIN', () => {
    // The late-mounted `highlightAfter: 'hydration'` case: `shouldHighlight` is true on the
    // first render, but the fallback was never promoted, so it is plain. Deferring would
    // paint plain then flash highlighted — so the latch must NOT engage; decode on mount.
    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    const fallbackSpy = vi.spyOn(fallbackFormatModule, 'fallbackToHast');
    render(
      <Pre shouldHighlight fallback={plainFallback} fallbackLineCounts={counts}>
        {decodedSource}
      </Pre>,
    );
    expect(decodeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      fallbackSpy.mock.invocationCallOrder[0],
    );
    expect(screen.getByText('DECODED')).toBeTruthy();
  });

  it('decodes on the first render when not init (shouldHighlight false)', () => {
    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    const fallbackSpy = vi.spyOn(fallbackFormatModule, 'fallbackToHast');
    render(
      <Pre fallback={plainFallback} fallbackLineCounts={counts}>
        {decodedSource}
      </Pre>,
    );
    // No latch: the decode runs during the first render, before the fallback memo.
    expect(decodeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      fallbackSpy.mock.invocationCallOrder[0],
    );
    expect(screen.getByText('DECODED')).toBeTruthy();
  });

  it('does not defer when there is no fallback to paint first', () => {
    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    render(
      <Pre shouldHighlight fallbackLineCounts={counts}>
        {decodedSource}
      </Pre>,
    );
    // `shouldHighlight` is true but there is no `fallback`, so deferring would
    // blank the first paint — decode on mount instead.
    expect(decodeSpy).toHaveBeenCalled();
    expect(screen.getByText('DECODED')).toBeTruthy();
  });
});
