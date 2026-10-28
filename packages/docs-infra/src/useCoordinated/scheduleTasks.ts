// Internal task-scheduling primitives shared by the coordination/render-timing
// code (and a few consumers that gate heavy work off the critical path). Kept
// here rather than in a `*Utils` barrel so it stays an internal helper, not a
// published API surface. Not re-exported from `index.ts`.

interface SchedulerLike {
  yield?: () => Promise<void>;
}

interface IdleGlobals {
  requestIdleCallback?: (task: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Yield the current task back to the browser so it can paint and process input
 * before the awaited continuation runs.
 *
 * Uses `scheduler.yield()` when available (modern Chromium) for better priority
 * handling; falls back to `setTimeout(_, 0)`, which macrotask-defers in every
 * browser, in Node/SSR, and in fake-timer test environments.
 */
export function yieldToMain(): Promise<void> {
  const { scheduler } = globalThis as { scheduler?: SchedulerLike };
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Run `task` during the browser's first idle period, falling back to
 * `setTimeout(task, 0)` where `requestIdleCallback` is unavailable (Safari,
 * Node/SSR, fake timers). Use this for genuinely deferrable background work
 * (e.g. stale-while-revalidate refreshes, the `idle` highlight/enhance swap)
 * that should wait for the main thread to be free.
 *
 * @param options.timeout forwarded to `requestIdleCallback` so the task still
 *   runs even if the browser never goes idle.
 * @returns a function that cancels the task if it has not run yet.
 */
export function requestIdle(task: () => void, options?: { timeout?: number }): () => void {
  const idleGlobals = globalThis as IdleGlobals;
  if (idleGlobals.requestIdleCallback) {
    const handle = idleGlobals.requestIdleCallback(task, options);
    return () => idleGlobals.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}
