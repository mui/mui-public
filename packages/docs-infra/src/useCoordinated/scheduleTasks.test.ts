import { describe, it, expect } from 'vitest';
import { yieldToMain, requestIdle } from './scheduleTasks';

/** Resolve after the next macrotask so `setTimeout(_, 0)`-backed work can run. */
function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('yieldToMain', () => {
  it('resolves on a later macrotask when scheduler.yield is unavailable', async () => {
    const host = globalThis as { scheduler?: unknown };
    const previous = host.scheduler;
    host.scheduler = undefined;
    try {
      let resolved = false;
      const promise = yieldToMain().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false); // deferred, not synchronous
      await promise;
      expect(resolved).toBe(true);
    } finally {
      host.scheduler = previous;
    }
  });

  it('delegates to scheduler.yield when available', async () => {
    const host = globalThis as { scheduler?: unknown };
    const previous = host.scheduler;
    let yielded = 0;
    host.scheduler = {
      yield: () => {
        yielded += 1;
        return Promise.resolve();
      },
    };
    try {
      await yieldToMain();
      expect(yielded).toBe(1);
    } finally {
      host.scheduler = previous;
    }
  });
});

describe('requestIdle', () => {
  it('runs the task on a later macrotask when requestIdleCallback is unavailable', async () => {
    const host = globalThis as { requestIdleCallback?: unknown };
    const previous = host.requestIdleCallback;
    host.requestIdleCallback = undefined;
    try {
      let ran = false;
      const cancel = requestIdle(() => {
        ran = true;
      });
      expect(ran).toBe(false);
      await flushMacrotasks();
      expect(ran).toBe(true);
      cancel(); // cancelling after it ran is a harmless no-op
    } finally {
      host.requestIdleCallback = previous;
    }
  });

  it('uses requestIdleCallback, forwards the timeout, and cancels via cancelIdleCallback', () => {
    const host = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const previous = { ric: host.requestIdleCallback, cic: host.cancelIdleCallback };
    const timeouts: Array<number | undefined> = [];
    const cancelled: number[] = [];
    host.requestIdleCallback = (_task: () => void, options?: { timeout?: number }) => {
      timeouts.push(options?.timeout);
      return 42;
    };
    host.cancelIdleCallback = (handle: number) => {
      cancelled.push(handle);
    };
    try {
      const cancel = requestIdle(() => {}, { timeout: 2000 });
      expect(timeouts).toEqual([2000]);
      cancel();
      expect(cancelled).toEqual([42]);
    } finally {
      host.requestIdleCallback = previous.ric;
      host.cancelIdleCallback = previous.cic;
    }
  });
});
