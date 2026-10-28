/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleDeferredPrecompute } from './scheduleDeferredPrecompute';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockBrowserScheduler() {
  let handleIntersection: IntersectionObserverCallback = () => {};
  let idleCallback: IdleRequestCallback = () => {};
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    idleCallback = callback;
    return 1;
  });
  const cancelIdleCallback = vi.fn();

  vi.stubGlobal(
    'IntersectionObserver',
    class IntersectionObserverMock {
      constructor(callback: IntersectionObserverCallback) {
        handleIntersection = callback;
      }

      observe() {}

      disconnect() {}
    },
  );
  vi.stubGlobal('requestIdleCallback', requestIdleCallback);
  vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

  return {
    cancelIdleCallback,
    requestIdleCallback,
    intersect() {
      handleIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
    runIdle() {
      idleCallback({ didTimeout: false, timeRemaining: () => 50 });
    },
  };
}

describe('scheduleDeferredPrecompute', () => {
  it('loads at idle after the root approaches the viewport', () => {
    const root = document.createElement('div');
    const load = vi.fn();
    const scheduler = mockBrowserScheduler();

    scheduleDeferredPrecompute({ root, enhanceAfter: 'idle', load, timeout: 10_000 });

    expect(scheduler.requestIdleCallback).not.toHaveBeenCalled();
    scheduler.intersect();
    expect(scheduler.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();

    scheduler.runIdle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads immediately when the user interacts before idle', () => {
    const root = document.createElement('div');
    const load = vi.fn();
    const scheduler = mockBrowserScheduler();

    scheduleDeferredPrecompute({ root, enhanceAfter: 'idle', load, timeout: 10_000 });
    scheduler.intersect();
    root.dispatchEvent(new Event('pointerdown'));

    expect(load).toHaveBeenCalledTimes(1);
    expect(scheduler.cancelIdleCallback).toHaveBeenCalledWith(1);
  });
});
