import { requestIdle } from '../useCoordinated/scheduleTasks';

interface ScheduleDeferredPrecomputeOptions {
  root: HTMLElement | null | undefined;
  enhanceAfter: 'init' | 'stream' | 'hydration' | 'idle' | undefined;
  load: () => void;
  timeout: number;
}

/** Schedules deferred precompute off the critical path, unless the user engages first. */
export function scheduleDeferredPrecompute({
  root,
  enhanceAfter,
  load,
  timeout,
}: ScheduleDeferredPrecomputeOptions) {
  let started = false;
  let cancelScheduledLoad: (() => void) | undefined;
  let observer: IntersectionObserver | undefined;

  function removeInteractionListeners() {
    root?.removeEventListener('pointerdown', startLoad);
    root?.removeEventListener('focusin', startLoad);
  }

  function startLoad() {
    if (started) {
      return;
    }
    started = true;
    cancelScheduledLoad?.();
    observer?.disconnect();
    removeInteractionListeners();
    load();
  }

  function scheduleLoad() {
    if ((enhanceAfter ?? 'idle') === 'idle') {
      cancelScheduledLoad = requestIdle(startLoad, { timeout });
    } else {
      startLoad();
    }
  }

  root?.addEventListener('pointerdown', startLoad, { passive: true });
  root?.addEventListener('focusin', startLoad);

  if (!root || typeof IntersectionObserver === 'undefined') {
    scheduleLoad();
  } else {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          scheduleLoad();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(root);
  }

  return () => {
    cancelScheduledLoad?.();
    observer?.disconnect();
    removeInteractionListeners();
  };
}
