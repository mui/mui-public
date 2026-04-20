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
const gutterCleanupTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function isElementInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

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
  const toggleRef = React.useRef<HTMLLabelElement>(null);

  // CSS `overflow-anchor: none` on hidden frames (set in CSS) nudges native
  // scroll anchoring toward the visible highlighted/focus content. In Chromium
  // and Firefox this usually handles most compensation synchronously, while the
  // rAF loop below smooths any remaining drift so the transition appears stable
  // and visually "fixed" to the user. In browsers without native overflow-anchor
  // support (e.g. Safari), the rAF loop is the primary compensation mechanism.

  const anchorScroll = React.useCallback((direction: 'collapse' | 'expand') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const primaryAnchor = container.querySelector<HTMLElement>(ANCHOR_SELECTOR);
    const toggleAnchor = toggleRef.current;

    let anchor = primaryAnchor ?? toggleAnchor;
    if (direction === 'collapse' && primaryAnchor && !isElementInViewport(primaryAnchor)) {
      anchor = toggleAnchor ?? primaryAnchor;
    }

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
    let cleanupTimer: ReturnType<typeof setTimeout>;

    // Use ResizeObserver to compensate only when the container layout
    // actually changes, rather than polling every animation frame.
    // Callbacks fire after layout, so getBoundingClientRect() reads
    // already-computed values without forcing an extra reflow.
    const observer = new ResizeObserver(() => {
      if (!active) {
        return;
      }
      const delta = anchor.getBoundingClientRect().top - initialTop;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
      }
    });

    // Stop compensating if the user interacts (scroll, click, keyboard),
    // since UI changes like tab switches can invalidate anchor measurements.
    function cleanup() {
      if (!active) {
        return;
      }
      active = false;
      clearTimeout(cleanupTimer);
      observer.disconnect();
      window.removeEventListener('wheel', stopOnUserInteraction);
      window.removeEventListener('touchmove', stopOnUserInteraction);
      window.removeEventListener('pointerdown', stopOnUserInteraction);
      window.removeEventListener('keydown', stopOnUserInteraction);
    }

    function stopOnUserInteraction() {
      cleanup();
    }
    window.addEventListener('wheel', stopOnUserInteraction, { passive: true, once: true });
    window.addEventListener('touchmove', stopOnUserInteraction, { passive: true, once: true });
    window.addEventListener('pointerdown', stopOnUserInteraction, { passive: true, once: true });
    window.addEventListener('keydown', stopOnUserInteraction, { passive: true, once: true });

    observer.observe(container);

    // Safety cleanup after the CSS transition completes.
    const timeout = getTransitionTimeout(direction);
    cleanupTimer = setTimeout(cleanup, timeout + 500);
  }, []);

  return { containerRef, toggleRef, anchorScroll };
}
