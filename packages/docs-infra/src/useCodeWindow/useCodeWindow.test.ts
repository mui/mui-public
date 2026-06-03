/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCodeWindow } from './useCodeWindow';

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }
}

function setupResizeObserver() {
  MockResizeObserver.instances = [];
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
}

function buildContainer({ withFrame = true }: { withFrame?: boolean } = {}) {
  const container = document.createElement('div');
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.appendChild(code);
  container.appendChild(pre);
  if (withFrame) {
    const frame = document.createElement('span');
    frame.setAttribute('data-frame-type', 'highlighted');
    code.appendChild(frame);
  }
  document.body.appendChild(container);
  return { container, pre, code };
}

describe('useCodeWindow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns refs and an anchorScroll callback', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    expect(result.current.containerRef.current).toBeNull();
    expect(result.current.scrollContainerRef.current).toBeNull();
    expect(result.current.toggleRef.current).toBeNull();
    expect(typeof result.current.anchorScroll).toBe('function');
  });

  it('compensates the attached scrollContainerRef instead of the window', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container } = buildContainer();
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    result.current.containerRef.current = container;
    result.current.scrollContainerRef.current = scroller;

    // Anchor moves from top 0 (session start) to 12 (after the resize), so
    // the hook should nudge the scroll container by the +12 delta.
    const anchor = container.querySelector<HTMLElement>('[data-frame-type="highlighted"]')!;
    const rectSpy = vi.spyOn(anchor, 'getBoundingClientRect');
    rectSpy.mockReturnValueOnce({ top: 0 } as DOMRect);
    rectSpy.mockReturnValue({ top: 12 } as DOMRect);

    // jsdom doesn't implement scrolling on Element; simulate it so `scrollTop`
    // tracks `scrollBy` and the hook sees the container absorb the delta.
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });
    const scrollerScrollBy = vi.fn((_x: number, yOffset: number) => {
      scrollTop += yOffset;
    });
    scroller.scrollBy = scrollerScrollBy as unknown as typeof scroller.scrollBy;
    const windowScrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    act(() => {
      result.current.anchorScroll('expand');
    });
    act(() => {
      const observer = MockResizeObserver.instances[0];
      observer.callback([], observer as unknown as ResizeObserver);
    });

    expect(scrollerScrollBy).toHaveBeenCalledWith(0, 12);
    expect(windowScrollBy).not.toHaveBeenCalled();
  });

  it('does nothing without a container', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    act(() => {
      result.current.anchorScroll('expand');
    });

    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('finds the highlighted frame as the anchor and starts a session', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container } = buildContainer();
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('expand');
    });

    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances[0].observed).toContain(container);
  });

  it('falls back to the toggle when no frame matches', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container } = buildContainer({ withFrame: false });
    const toggle = document.createElement('button');
    container.appendChild(toggle);
    result.current.containerRef.current = container;
    result.current.toggleRef.current = toggle;

    act(() => {
      result.current.anchorScroll('expand');
    });

    expect(MockResizeObserver.instances).toHaveLength(1);
  });

  it('does nothing when there is no anchor and no toggle', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container } = buildContainer({ withFrame: false });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('expand');
    });

    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('honors a custom anchor selector', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow({ anchorSelector: '[data-my-anchor]' }));

    const { container, code } = buildContainer({ withFrame: false });
    const customAnchor = document.createElement('span');
    customAnchor.setAttribute('data-my-anchor', '');
    code.appendChild(customAnchor);
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('expand');
    });

    expect(MockResizeObserver.instances).toHaveLength(1);
  });

  it('sets data-scrollbar-gutter on collapse when content overflows', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre, code } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
    // The code's own width (scoped to the container) drives the decision.
    Object.defineProperty(code, 'scrollWidth', { value: 200, configurable: true });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(pre.getAttribute('data-scrollbar-gutter')).toBe('collapse-from');
  });

  it('skips gutter animation when content does not overflow', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre, code } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(code, 'scrollWidth', { value: 50, configurable: true });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(pre.hasAttribute('data-scrollbar-gutter')).toBe(false);
  });

  it('skips gutter animation with overlay scrollbars (zero scrollbar height)', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'scrollWidth', { value: 200, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(pre.hasAttribute('data-scrollbar-gutter')).toBe(false);
  });

  it('only animates the expand gutter when the collapsible probe matches', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre, code } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(code, 'scrollWidth', { value: 200, configurable: true });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('expand');
    });
    expect(pre.hasAttribute('data-scrollbar-gutter')).toBe(false);

    const probe = document.createElement('span');
    probe.setAttribute('data-collapsible', '');
    code.appendChild(probe);

    act(() => {
      result.current.anchorScroll('expand');
    });
    expect(pre.getAttribute('data-scrollbar-gutter')).toBe('expand-from');
  });

  it('drives the gutter on the attached scrollContainerRef instead of the pre', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre, code } = buildContainer();
    const scroller = document.createElement('div');
    scroller.appendChild(container);
    document.body.appendChild(scroller);

    // The window (scroller) owns the horizontal scroll, so the gutter swap and
    // its scrollbar measurement run on it, not the inner pre.
    Object.defineProperty(scroller, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });
    // The code's own width (scoped to the container) drives the decision.
    Object.defineProperty(code, 'scrollWidth', { value: 200, configurable: true });

    result.current.containerRef.current = container;
    result.current.scrollContainerRef.current = scroller;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(scroller.getAttribute('data-scrollbar-gutter')).toBe('collapse-from');
    expect(pre.hasAttribute('data-scrollbar-gutter')).toBe(false);
  });

  it('scopes the overflow decision to the container, not the shared scroll container', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, code } = buildContainer();
    const scroller = document.createElement('div');
    scroller.appendChild(container);
    // A sibling code block in the same scroll container that DOES overflow.
    const otherPre = document.createElement('pre');
    const otherCode = document.createElement('code');
    otherPre.appendChild(otherCode);
    scroller.appendChild(otherPre);
    document.body.appendChild(scroller);

    Object.defineProperty(scroller, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });
    // This block's code fits the window; only the unrelated sibling overflows.
    Object.defineProperty(code, 'scrollWidth', { value: 50, configurable: true });
    Object.defineProperty(otherCode, 'scrollWidth', { value: 500, configurable: true });

    result.current.containerRef.current = container;
    result.current.scrollContainerRef.current = scroller;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    // No swap: this block fits, even though the shared container overflows
    // because of the sibling block.
    expect(scroller.hasAttribute('data-scrollbar-gutter')).toBe(false);
  });

  it('snaps horizontal scroll back to 0 on collapse even without the WAAPI animation', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre, code } = buildContainer();
    // No WAAPI available on the code element: the smooth transform can't run,
    // but the scroll position should still snap to the left edge.
    (code as unknown as { animate?: unknown }).animate = undefined;
    let scrollLeft = 40;
    Object.defineProperty(pre, 'scrollLeft', {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
      configurable: true,
    });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(pre.scrollLeft).toBe(0);
  });
});
