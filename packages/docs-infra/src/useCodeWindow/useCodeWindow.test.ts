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
    expect(result.current.toggleRef.current).toBeNull();
    expect(typeof result.current.anchorScroll).toBe('function');
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

    const { container, pre } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'scrollWidth', { value: 200, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
    result.current.containerRef.current = container;

    act(() => {
      result.current.anchorScroll('collapse');
    });

    expect(pre.getAttribute('data-scrollbar-gutter')).toBe('collapse-from');
  });

  it('skips gutter animation when content does not overflow', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useCodeWindow());

    const { container, pre } = buildContainer();
    Object.defineProperty(pre, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 20, configurable: true });
    Object.defineProperty(pre, 'scrollWidth', { value: 50, configurable: true });
    Object.defineProperty(pre, 'clientWidth', { value: 100, configurable: true });
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
});
