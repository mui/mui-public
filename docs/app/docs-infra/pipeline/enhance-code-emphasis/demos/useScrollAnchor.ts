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

  // The CSS sets padding-bottom on the pre (e.g. 6px). The inline padding
  // must equal scrollbarHeight + cssPadding so total bottom space is constant
  // when the scrollbar disappears.
  const cssPaddingBottom = parseFloat(getComputedStyle(pre).paddingBottom) || 0;
  const totalPadding = scrollbarHeight + cssPaddingBottom;

  // Swap scrollbar for padding in one frame
  pre.style.overflowX = 'hidden';
  pre.style.paddingBottom = `${totalPadding}px`;

  // Animate padding down to CSS base value over the collapse duration
  requestAnimationFrame(() => {
    pre.style.transition = `padding-bottom 0.3s ease`;
    pre.style.paddingBottom = `${cssPaddingBottom}px`;

    const timeout = getTransitionTimeout('collapse');
    setTimeout(() => {
      pre.style.paddingBottom = '';
      pre.style.transition = '';
      pre.style.overflowX = '';
    }, timeout);
  });
}

/**
 * Whether the browser supports CSS Scroll Anchoring (`overflow-anchor`).
 * Chrome 56+ and Firefox 66+ support it; Safari does not.
 * When supported, we must disable it on the scroller before the rendering
 * step so that only our rAF loop compensates — avoiding double-adjustment.
 */
const supportsOverflowAnchor =
  typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto');

export function useScrollAnchor() {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // CSS `overflow-anchor: none` on collapsing frames guides the browser's
  // native scroll anchoring to use highlighted/focus frames — works pre-hydration.
  // Post-hydration we disable native anchoring on the scroller permanently
  // and use the rAF loop as the sole compensation mechanism.
  // Toggling overflow-anchor per-transition caused scroll jumps because the
  // browser would re-anchor when the property was restored between cycles.
  React.useEffect(() => {
    if (supportsOverflowAnchor) {
      document.documentElement.style.overflowAnchor = 'none';
    }
    return () => {
      if (supportsOverflowAnchor) {
        document.documentElement.style.overflowAnchor = '';
      }
    };
  }, []);

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
    // an instant 15px height shrink. On expand, the rAF loop naturally
    // compensates for the scrollbar appearing — no animation needed.
    if (direction === 'collapse') {
      const pre = container.querySelector<HTMLElement>('pre');
      if (pre) {
        animateScrollbarGutter(pre);
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
