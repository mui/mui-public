'use client';
import * as React from 'react';
import { useScrollAnchor } from '../useScrollAnchor/useScrollAnchor';

export type UseCodeWindowOptions = {
  /**
   * Duration of the expand transition in ms. Should match the CSS
   * transition on the collapsible container. Used to size the
   * page-scroll compensation window.
   * @default 350
   */
  expandDuration?: number;
  /**
   * Duration of the collapse transition in ms. Should match the CSS
   * transition on the collapsible container.
   * @default 350
   */
  collapseDuration?: number;
  /**
   * Duration of the smooth scroll-back animation that returns the
   * `<code>` element's `scrollLeft` to `0` on collapse. Set to `0`
   * to disable. Honors `prefers-reduced-motion`.
   * @default 300
   */
  scrollBackDuration?: number;
  /**
   * CSS selector(s) used to find the anchor element inside the
   * container. The first match wins. Falls back to the toggle ref
   * when no match exists, or when the match is offscreen on collapse.
   * @default '[data-frame-type="highlighted"], [data-frame-type="focus"]'
   */
  anchorSelector?: string;
  /**
   * CSS selector that, when present inside the `<pre>`, opts the
   * expand transition into the scrollbar-gutter animation. Useful
   * when expansion can reveal previously hidden long lines and the
   * horizontal scrollbar would otherwise appear with a snap.
   * @default '[data-collapsible]'
   */
  collapsibleProbeSelector?: string;
};

export type UseCodeWindowResult<
  ToggleElement extends HTMLElement = HTMLElement,
  ScrollElement extends HTMLElement = HTMLElement,
> = {
  /**
   * Ref to attach to the collapsible container element.
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Optional ref to attach to a scrollable ancestor that should be
   * compensated instead of the page. Attach it when the code block is
   * rendered as a fixed-height "window" (its own `overflow: auto` region)
   * so the anchor stays put against the panel's own scroll rather than the
   * page. When left unattached, the page is compensated — the right default
   * for code that grows the document flow. Forwarded from `useScrollAnchor`.
   *
   * When attached, this element is also treated as the horizontal scroll
   * owner: the scrollbar-gutter swap (`data-scrollbar-gutter`) and the
   * collapse scroll-back run on it instead of the inner `<pre>`. Use this when
   * the window owns both scroll axes so the horizontal scrollbar sits at the
   * window's edge (in view) rather than at the bottom of the inner `<pre>`,
   * which can extend past the window's height and scroll out of view. Your
   * gutter CSS must then key off this element's attribute.
   */
  scrollContainerRef: React.RefObject<ScrollElement | null>;
  /**
   * Ref to attach to the toggle element. Used as a fallback anchor
   * when the primary anchor is offscreen on collapse.
   */
  toggleRef: React.RefObject<ToggleElement | null>;
  /**
   * Call **just before** flipping the expanded/collapsed state. The
   * page will scroll so the anchor element stays put while the
   * container animates.
   */
  anchorScroll: (direction: 'collapse' | 'expand') => void;
};

const GUTTER_STATE_ATTRIBUTE = 'data-scrollbar-gutter';
const gutterCleanupTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout> | Animation>();
const gutterFlipTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const scrollbackAnimations = new WeakMap<HTMLElement, Animation>();

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Schedules `callback` to run after `duration` ms on the browser's animation
 * timeline (via a no-op WAAPI animation), so DevTools' animation speed slider
 * scales the delay in step with CSS transitions. Falls back to `setTimeout`
 * when WAAPI isn't available.
 *
 * Cancelling the returned `Animation` does NOT invoke `callback` (the
 * rejected `finished` promise is swallowed), matching `clearTimeout`
 * semantics.
 */
function scheduleOnAnimationTimeline(
  target: HTMLElement,
  duration: number,
  callback: () => void,
): Animation | ReturnType<typeof setTimeout> {
  if (typeof target.animate === 'function') {
    const anim = target.animate([{ opacity: 1 }, { opacity: 1 }], { duration, fill: 'none' });
    anim.finished.then(callback, () => {
      // Swallow rejection from `Animation.cancel()` so cancelling the
      // schedule doesn't fire the cleanup callback.
    });
    return anim;
  }
  return setTimeout(callback, duration);
}

function cancelScheduled(handle: Animation | ReturnType<typeof setTimeout> | undefined) {
  if (handle === undefined) {
    return;
  }
  // Guard the `instanceof` so we don't throw a `ReferenceError` in browsers
  // that lack WAAPI (where `Animation` is undefined as a global).
  if (typeof Animation !== 'undefined' && handle instanceof Animation) {
    handle.cancel();
  } else {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

/**
 * Smoothly slides the `<code>` element back to the left edge over `duration`
 * ms using an ease-out cubic via the Web Animations API.
 *
 * `scrollEl` is whichever element owns the horizontal scroll — the inner
 * `<pre>` by default, or an attached scroll container (see `scrollContainerRef`)
 * when the code block is rendered inside a fixed-size window. `code` is this
 * code window's own `<code>` (scoped to its container by the caller) so a shared
 * scroll container holding several blocks animates the right one.
 *
 * Used during collapse instead of tweening `scrollEl.scrollLeft` because the
 * scrollbar-gutter animation forces `overflow-x: hidden` on `scrollEl`, which
 * snaps `scrollLeft` to 0 instantly. Animating a transform on the inner
 * `code` element produces the same visual effect, isn't reset by the overflow
 * change, and is naturally clipped by the scroll element's hidden overflow.
 *
 * Honors `prefers-reduced-motion` by snapping immediately.
 */
function smoothCollapseScrollLeft(
  scrollEl: HTMLElement,
  code: HTMLElement | null,
  duration: number,
): Animation | null {
  const startLeft = scrollEl.scrollLeft;
  if (startLeft <= 0) {
    return null;
  }

  // Cancel any leftover scroll-back animation from a previous toggle so we
  // don't end up with two transforms competing on the same element.
  scrollbackAnimations.get(scrollEl)?.cancel();
  scrollbackAnimations.delete(scrollEl);

  // Snap the actual scroll position back to the left edge now. When we can
  // animate, the WAAPI transform below visually compensates by translating the
  // element from `-startLeft` back to `0`; otherwise (no WAAPI, no `code`,
  // reduced motion, or zero duration) this stands as an instant snap — still
  // the correct collapsed end state.
  scrollEl.scrollLeft = 0;

  if (!code || typeof code.animate !== 'function' || prefersReducedMotion() || duration <= 0) {
    return null;
  }

  const anim = code.animate(
    [{ transform: `translateX(${-startLeft}px)` }, { transform: 'translateX(0)' }],
    {
      duration,
      easing: 'cubic-bezier(0, 0, 0.2, 1)',
      fill: 'none',
    },
  );
  scrollbackAnimations.set(scrollEl, anim);
  const onSettle = () => {
    if (scrollbackAnimations.get(scrollEl) === anim) {
      scrollbackAnimations.delete(scrollEl);
    }
  };
  anim.finished.then(onSettle, onSettle);
  return anim;
}

function isElementInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * Measures the horizontal scrollbar height of the scroll element by
 * temporarily forcing `overflow-x: scroll`.
 */
function measureScrollbarHeight(scrollEl: HTMLElement): number {
  const prevOverflow = scrollEl.style.overflowX;
  scrollEl.style.overflowX = 'scroll';
  const scrollbarHeight = scrollEl.offsetHeight - scrollEl.clientHeight;
  scrollEl.style.overflowX = prevOverflow;
  return scrollbarHeight;
}

function clearGutterState(scrollEl: HTMLElement) {
  cancelScheduled(gutterCleanupTimers.get(scrollEl));
  gutterCleanupTimers.delete(scrollEl);
  const flipTimer = gutterFlipTimers.get(scrollEl);
  if (flipTimer !== undefined) {
    clearTimeout(flipTimer);
    gutterFlipTimers.delete(scrollEl);
  }
  scrollEl.removeAttribute(GUTTER_STATE_ATTRIBUTE);
}

function cancelAllForScrollEl(scrollEl: HTMLElement) {
  scrollbackAnimations.get(scrollEl)?.cancel();
  scrollbackAnimations.delete(scrollEl);
  clearGutterState(scrollEl);
}

/**
 * Drives a from→to transition on the `data-scrollbar-gutter` attribute of
 * the scroll element, which the consumer's CSS hooks into to animate the swap
 * between a real scrollbar and equivalent padding-bottom.
 *
 * `scrollEl` is whichever element owns the horizontal scroll — the inner
 * `<pre>` by default, or the attached `scrollContainerRef` when the code block
 * is rendered inside a fixed-size window. `code` is this code window's own
 * `<code>` (scoped to its container by the caller).
 *
 * Skips the animation when content doesn't overflow (no scrollbar exists)
 * or when the browser uses overlay scrollbars (zero height).
 */
function animateScrollbarGutter(
  scrollEl: HTMLElement,
  code: HTMLElement | null,
  from: 'collapse-from' | 'expand-from',
  to: 'collapse-to' | 'expand-to',
  durationMs: number,
) {
  const scrollbarHeight = measureScrollbarHeight(scrollEl);
  if (scrollbarHeight === 0) {
    return; // Overlay scrollbars, nothing to do
  }

  // Decide from this code window's own `<code>`, not from `scrollEl` — the
  // scroll owner may be a shared container wrapping other content. `code`'s
  // `scrollWidth` reflects hidden frames (via `min-width: fit-content`), so it
  // predicts the post-expand width and still reflects the wide source during
  // collapse; compare it against the scroll owner's visible width.
  if (!code || code.scrollWidth <= scrollEl.clientWidth) {
    return;
  }

  clearGutterState(scrollEl);
  scrollEl.setAttribute(GUTTER_STATE_ATTRIBUTE, from);

  // Move into the transition state on the next macrotask. Tracked so the
  // flip can be cancelled if the component unmounts before it fires.
  const flipTimer = setTimeout(() => {
    gutterFlipTimers.delete(scrollEl);
    scrollEl.setAttribute(GUTTER_STATE_ATTRIBUTE, to);
  }, 0);
  gutterFlipTimers.set(scrollEl, flipTimer);

  // Schedule cleanup on the animation timeline so DevTools throttling
  // scales it together with the CSS transition.
  const cleanup = scheduleOnAnimationTimeline(scrollEl, durationMs + 30, () => {
    clearGutterState(scrollEl);
  });
  gutterCleanupTimers.set(scrollEl, cleanup);
}

const DEFAULT_ANCHOR_SELECTOR = '[data-frame-type="highlighted"], [data-frame-type="focus"]';
const DEFAULT_COLLAPSIBLE_SELECTOR = '[data-collapsible]';

/**
 * Layered helper that combines `useScrollAnchor` with the additional
 * choreography needed when expanding/collapsing a syntax-highlighted code
 * block.
 *
 * On top of the page-scroll compensation provided by `useScrollAnchor`, it:
 *
 * - Selects an anchor inside the container (highlighted or focus frame),
 *   falling back to the toggle when the primary anchor is offscreen on
 *   collapse.
 * - Drives a `data-scrollbar-gutter` attribute on the inner `<pre>` so the
 *   consumer's CSS can swap between a real horizontal scrollbar and
 *   equivalent `padding-bottom` without a snap.
 * - Smoothly returns the `<code>` element's `scrollLeft` to `0` on
 *   collapse via a compositor-driven transform, so the focused region
 *   (which usually starts at column 0) is back in view after collapse.
 *
 * The hook expects a structure like:
 *
 * ```jsx
 * <div ref={containerRef}>
 *   <pre>
 *     <code>...</code>
 *   </pre>
 *   <button ref={toggleRef}>Expand</button>
 * </div>
 * ```
 *
 * Anchor selection and the collapsible probe are configurable so it works
 * with any highlighter that marks frames with data attributes.
 */
export function useCodeWindow<
  ToggleElement extends HTMLElement = HTMLElement,
  ScrollElement extends HTMLElement = HTMLElement,
>(options: UseCodeWindowOptions = {}): UseCodeWindowResult<ToggleElement, ScrollElement> {
  const {
    expandDuration = 350,
    collapseDuration = 350,
    scrollBackDuration = 300,
    anchorSelector = DEFAULT_ANCHOR_SELECTOR,
    collapsibleProbeSelector = DEFAULT_COLLAPSIBLE_SELECTOR,
  } = options;

  const toggleRef = React.useRef<ToggleElement | null>(null);
  const lastScrollElRef = React.useRef<HTMLElement | null>(null);

  const {
    containerRef,
    scrollContainerRef,
    anchorScroll: rawAnchorScroll,
  } = useScrollAnchor<HTMLDivElement, ScrollElement>();

  React.useEffect(() => {
    return () => {
      const scrollEl = lastScrollElRef.current;
      if (scrollEl) {
        cancelAllForScrollEl(scrollEl);
        lastScrollElRef.current = null;
      }
    };
  }, []);

  const anchorScroll = React.useCallback(
    (direction: 'collapse' | 'expand') => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const primaryAnchor = container.querySelector<HTMLElement>(anchorSelector);
      const toggleAnchor = toggleRef.current;

      let anchor = primaryAnchor ?? toggleAnchor;
      if (direction === 'collapse' && primaryAnchor && !isElementInViewport(primaryAnchor)) {
        anchor = toggleAnchor ?? primaryAnchor;
      }

      if (!anchor) {
        return;
      }

      // The element whose horizontal scrollbar we smooth: the attached scroll
      // container when one is provided (the code block lives inside a
      // fixed-size window that owns both scroll axes), otherwise the inner
      // `<pre>`, which scrolls horizontally on its own.
      const scrollEl = scrollContainerRef.current ?? container.querySelector<HTMLElement>('pre');
      // Scope content lookups to *this* code window's `container`, never to
      // `scrollEl`: an attached scroll container may wrap several code blocks or
      // unrelated content, so `scrollEl.querySelector('code')` could match the
      // wrong block. The overflow decision and scroll-back both use this code.
      const code = container.querySelector<HTMLElement>('code');
      if (scrollEl) {
        lastScrollElRef.current = scrollEl;
        if (direction === 'collapse') {
          // Smoothly return horizontal scroll to the left edge. We animate
          // via a transform on the inner `code` element rather than
          // tweening `scrollEl.scrollLeft`, because the gutter animation below
          // sets `overflow-x: hidden` which would snap `scrollLeft` to 0
          // instantly. Both animations start in the same frame: the
          // scroll-back resets `scrollLeft` to 0 up front, so the gutter
          // swap's `overflow-x` change has nothing left to snap.
          smoothCollapseScrollLeft(scrollEl, code, scrollBackDuration);
          animateScrollbarGutter(scrollEl, code, 'collapse-from', 'collapse-to', collapseDuration);
        }
        if (direction === 'expand') {
          // Cancel any in-flight collapse scroll-back so its leftover
          // transform can't drift the code horizontally during expand.
          scrollbackAnimations.get(scrollEl)?.cancel();
          scrollbackAnimations.delete(scrollEl);
          if (collapsibleProbeSelector && container.querySelector(collapsibleProbeSelector)) {
            animateScrollbarGutter(scrollEl, code, 'expand-from', 'expand-to', expandDuration);
          }
        }
      }

      rawAnchorScroll(anchor, direction === 'collapse' ? collapseDuration : expandDuration);
    },
    [
      containerRef,
      scrollContainerRef,
      rawAnchorScroll,
      anchorSelector,
      collapsibleProbeSelector,
      collapseDuration,
      expandDuration,
      scrollBackDuration,
    ],
  );

  return { containerRef, scrollContainerRef, toggleRef, anchorScroll };
}
