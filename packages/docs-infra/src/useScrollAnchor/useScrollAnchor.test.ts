/**
 * @vitest-environment jsdom
 */
import type * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollAnchor } from './useScrollAnchor';

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

  trigger() {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

function setupResizeObserver() {
  MockResizeObserver.instances = [];
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
}

function attachContainer<T extends HTMLElement>(ref: React.RefObject<T | null>, element: T) {
  ref.current = element;
}

describe('useScrollAnchor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a containerRef and an anchorScroll function', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    expect(result.current.containerRef.current).toBeNull();
    expect(typeof result.current.anchorScroll).toBe('function');
  });

  it('does nothing when the container is not attached', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const anchor = document.createElement('div');
    document.body.appendChild(anchor);

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('does nothing when the anchor is null', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());
    const container = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    act(() => {
      result.current.anchorScroll(null, 100);
    });

    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('observes the container and compensates page scroll on resize', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    container.appendChild(anchor);
    document.body.appendChild(container);
    attachContainer(result.current.containerRef, container);

    let top = 100;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top,
          bottom: top + 10,
          left: 0,
          right: 10,
          width: 10,
          height: 10,
          x: 0,
          y: top,
          toJSON: () => '',
        }) as DOMRect,
    );
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    expect(MockResizeObserver.instances).toHaveLength(1);
    const observer = MockResizeObserver.instances[0];
    expect(observer.observed).toContain(container);

    top = 150; // simulate layout shift pushing the anchor down by 50px
    act(() => {
      observer.trigger();
    });

    expect(scrollBy).toHaveBeenCalledWith(0, 50);
  });

  it('ignores sub-pixel deltas', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    let top = 100;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top,
          bottom: top,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: top,
          toJSON: () => '',
        }) as DOMRect,
    );
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    top = 100.3;
    act(() => {
      MockResizeObserver.instances[0].trigger();
    });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('disconnects the observer after the duration elapses', () => {
    vi.useFakeTimers();
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    expect(MockResizeObserver.instances[0].disconnected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(MockResizeObserver.instances[0].disconnected).toBe(true);
    vi.useRealTimers();
  });

  it('aborts the previous session when called again', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });
    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    expect(MockResizeObserver.instances).toHaveLength(2);
    expect(MockResizeObserver.instances[0].disconnected).toBe(true);
    expect(MockResizeObserver.instances[1].disconnected).toBe(false);
  });

  it('stops compensating on user interaction', () => {
    setupResizeObserver();
    const { result } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    const observer = MockResizeObserver.instances[0];
    expect(observer.disconnected).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });

    expect(observer.disconnected).toBe(true);
  });

  it('cleans up the active session on unmount', () => {
    setupResizeObserver();
    const { result, unmount } = renderHook(() => useScrollAnchor<HTMLDivElement>());

    const container = document.createElement('div');
    const anchor = document.createElement('div');
    attachContainer(result.current.containerRef, container);

    act(() => {
      result.current.anchorScroll(anchor, 100);
    });

    expect(MockResizeObserver.instances[0].disconnected).toBe(false);
    unmount();
    expect(MockResizeObserver.instances[0].disconnected).toBe(true);
  });

  describe('with scrollContainerRef attached', () => {
    it('scrolls the attached container instead of the window', () => {
      setupResizeObserver();
      const { result } = renderHook(() => useScrollAnchor<HTMLDivElement, HTMLDivElement>());

      const container = document.createElement('div');
      const scrollContainer = document.createElement('div');
      const anchor = document.createElement('div');
      attachContainer(result.current.containerRef, container);
      attachContainer(result.current.scrollContainerRef, scrollContainer);

      let top = 100;
      vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            top,
            bottom: top + 10,
            left: 0,
            right: 10,
            width: 10,
            height: 10,
            x: 0,
            y: top,
            toJSON: () => '',
          }) as DOMRect,
      );
      const windowScrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
      // jsdom doesn't implement scrollBy on Element, so define it before spying.
      scrollContainer.scrollBy = () => {};
      const containerScrollBy = vi.spyOn(scrollContainer, 'scrollBy').mockImplementation(() => {});

      act(() => {
        result.current.anchorScroll(anchor, 100);
      });

      top = 130;
      act(() => {
        MockResizeObserver.instances[0].trigger();
      });

      expect(containerScrollBy).toHaveBeenCalledWith(0, 30);
      expect(windowScrollBy).not.toHaveBeenCalled();
    });

    it('listens for user interaction on the attached container', () => {
      setupResizeObserver();
      const { result } = renderHook(() => useScrollAnchor<HTMLDivElement, HTMLDivElement>());

      const container = document.createElement('div');
      const scrollContainer = document.createElement('div');
      const anchor = document.createElement('div');
      attachContainer(result.current.containerRef, container);
      attachContainer(result.current.scrollContainerRef, scrollContainer);

      act(() => {
        result.current.anchorScroll(anchor, 100);
      });

      const observer = MockResizeObserver.instances[0];
      expect(observer.disconnected).toBe(false);

      // Window interaction shouldn't end the session when the scroll
      // target is a different element.
      act(() => {
        window.dispatchEvent(new Event('wheel'));
      });
      expect(observer.disconnected).toBe(false);

      act(() => {
        scrollContainer.dispatchEvent(new Event('wheel'));
      });
      expect(observer.disconnected).toBe(true);
    });
  });
});
