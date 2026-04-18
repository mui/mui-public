import * as React from 'react';

/**
 * Selector for the first highlighted or focus frame — the content the user
 * cares about. Anchoring to this keeps the focused code visually stable
 * in both expand and collapse directions.
 */
const ANCHOR_SELECTOR = ['[data-frame-type="highlighted"]', '[data-frame-type="focus"]'].join(', ');

/**
 * Whether the browser supports `interpolate-size: allow-keywords` —
 * determines which CSS transition path is active and thus how long
 * the rAF loop needs to run.
 *
 * - Enhanced: 300ms for both expand and collapse
 * - Fallback: 300ms collapse, 1500ms expand (max-height)
 */
const supportsInterpolateSize =
  typeof CSS !== 'undefined' && CSS.supports('interpolate-size', 'allow-keywords');

function getTransitionTimeout(direction: 'collapse' | 'expand'): number {
  if (supportsInterpolateSize) {
    // @supports path: height 0.3s ease in both directions
    return 350;
  }
  // Fallback path: max-height 0.3s collapse, 1.5s expand
  return direction === 'collapse' ? 350 : 1550;
}

const GUTTER_STATE_ATTRIBUTE = 'data-scrollbar-gutter';
const gutterCleanupTimers = new WeakMap<HTMLElement, number>();

/**
 * Measures the horizontal scrollbar height of a `<pre>` element by
 * temporarily forcing `overflow-x: scroll`.
 */
function measureScrollbarHeight(pre: HTMLElement): number {
  const prevOverflow = pre.style.overflowX;
  pre.style.overflowX = 'scroll';
  const scrollbarHeight = pre.offsetHeight - pre.clientHeight;
  pre.style.overflowX = prevOverflow;
  return scrollbarHeight;
}

function clearGutterState(pre: HTMLElement) {
  const existingTimer = gutterCleanupTimers.get(pre);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
    gutterCleanupTimers.delete(pre);
  }
  pre.removeAttribute(GUTTER_STATE_ATTRIBUTE);
}

/**
 * Smoothly transitions the horizontal scrollbar gutter on collapse by
 * swapping the real scrollbar for equivalent padding-bottom, then
 * animating that padding down to the CSS base value.
 *
 * Skips the animation when content doesn't overflow (no scrollbar exists)
 * or when the browser uses overlay scrollbars (zero height).
 */
function animateScrollbarGutter(pre: HTMLElement) {
  const scrollbarHeight = measureScrollbarHeight(pre);
  if (scrollbarHeight === 0) {
    return; // Overlay scrollbars, nothing to do
  }

  // Only animate if content actually overflows (scrollbar is visible)
  if (pre.scrollWidth <= pre.clientWidth) {
    return;
  }

  clearGutterState(pre);
  pre.setAttribute(GUTTER_STATE_ATTRIBUTE, 'collapse-from');

  // Move into the transition state on the next macrotask.
  setTimeout(() => {
    pre.setAttribute(GUTTER_STATE_ATTRIBUTE, 'collapse-to');
  }, 0);

  const timeout = getTransitionTimeout('collapse');
  const cleanupTimer = setTimeout(() => {
    clearGutterState(pre);
  }, timeout + 30);
  gutterCleanupTimers.set(pre, cleanupTimer);
}

/**
 * Smoothly transitions the horizontal scrollbar gutter on expand by
 * reserving the eventual scrollbar space via padding-bottom first,
 * then letting CSS swap to real overflow-x at the end of the transition.
 *
 * This is primarily needed for the max-size split-frame case where hidden
 * overflow lines can make the scrollbar appear late during expansion.
 */
function animateScrollbarGutterExpand(pre: HTMLElement) {
  const scrollbarHeight = measureScrollbarHeight(pre);
  if (scrollbarHeight === 0) {
    return; // Overlay scrollbars, nothing to do
  }

  clearGutterState(pre);
  pre.setAttribute(GUTTER_STATE_ATTRIBUTE, 'expand-from');

  // Move into the transition state on the next macrotask.
  setTimeout(() => {
    pre.setAttribute(GUTTER_STATE_ATTRIBUTE, 'expand-to');
  }, 0);

  const timeout = getTransitionTimeout('expand');
  const cleanupTimer = setTimeout(() => {
    clearGutterState(pre);
  }, timeout + 30);
  gutterCleanupTimers.set(pre, cleanupTimer);
}

export function useScrollAnchor() {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // CSS `overflow-anchor: none` on hidden frames (set in CSS) guides the browser's
  // native scroll anchoring to highlighted/focus frames — works both pre- and
  // post-hydration. In Chrome/Firefox, native anchoring compensates synchronously
  // per layout step, so the rAF loop below sees delta ≈ 0 and becomes a no-op,
  // avoiding Electron rAF throttling artifacts. The rAF loop acts as a fallback
  // for Safari, which has no native overflow-anchor support.

  const anchorScroll = React.useCallback((direction: 'collapse' | 'expand') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const anchor = container.querySelector<HTMLElement>(ANCHOR_SELECTOR);
    if (!anchor) {
      return;
    }

    // On collapse, animate the scrollbar gutter (padding swap) to avoid
    // an instant height shrink when horizontal scrollbar space disappears.
    // On expand, do the inverse only for truncated/max-size demos where
    // scrollbar space can appear late and look like a snap.
    const pre = container.querySelector<HTMLElement>('pre');
    if (pre) {
      if (direction === 'collapse') {
        animateScrollbarGutter(pre);
      }
      if (direction === 'expand' && pre.querySelector('[data-collapsible]')) {
        animateScrollbarGutterExpand(pre);
      }
    }

    const initialTop = anchor.getBoundingClientRect().top;
    let active = true;

    // Stop compensating if the user scrolls manually
    function cleanup() {
      if (!active) {
        return;
      }
      active = false;
      window.removeEventListener('wheel', stopOnUserScroll);
      window.removeEventListener('touchmove', stopOnUserScroll);
    }

    function stopOnUserScroll() {
      cleanup();
    }
    window.addEventListener('wheel', stopOnUserScroll, { passive: true, once: true });
    window.addEventListener('touchmove', stopOnUserScroll, { passive: true, once: true });

    const minRunMs = getTransitionTimeout(direction);
    const maxRunMs = minRunMs + 1200;
    const settleWindowMs = 120;
    const startedAt = performance.now();
    let lastAdjustmentAt = startedAt;
    let hasAdjusted = false;

    const compensate = (now: number) => {
      if (!active) {
        return;
      }
      const delta = anchor.getBoundingClientRect().top - initialTop;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
        lastAdjustmentAt = now;
        hasAdjusted = true;
      }

      const elapsed = now - startedAt;
      const settled =
        hasAdjusted && elapsed >= minRunMs && now - lastAdjustmentAt >= settleWindowMs;
      const exceededMax = elapsed >= maxRunMs;
      if (settled || exceededMax) {
        cleanup();
        return;
      }

      requestAnimationFrame(compensate);
    };

    requestAnimationFrame(compensate);

    // Failsafe in case rAF is throttled in a background tab.
    setTimeout(cleanup, maxRunMs + 100);
  }, []);

  return { containerRef, anchorScroll };
}
