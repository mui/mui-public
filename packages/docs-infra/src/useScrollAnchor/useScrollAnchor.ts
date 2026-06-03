'use client';
import * as React from 'react';

/**
 * Result returned by `useScrollAnchor`.
 */
export type UseScrollAnchorResult<
  TContainer extends HTMLElement,
  TScroll extends HTMLElement = HTMLElement,
> = {
  /**
   * Ref to attach to the element whose layout is about to change. Resize
   * events on this element drive the scroll compensation.
   */
  containerRef: React.RefObject<TContainer | null>;
  /**
   * Optional ref to attach to a scrollable ancestor that should be
   * compensated instead of the page. When left unattached, the hook
   * compensates `window` scroll, which is the right default for most
   * full-page layouts. Attach it when the changing container lives inside
   * its own `overflow: auto` region (chat threads, side panels, modals).
   */
  scrollContainerRef: React.RefObject<TScroll | null>;
  /**
   * Start an anchoring session. Records the current viewport position of
   * `anchor` and, while the container resizes over the next `duration` ms,
   * scrolls the page (or the attached `scrollContainerRef`) so the anchor
   * stays at the same position.
   *
   * The session ends when any of the following happens:
   * - The user interacts (wheel, touchmove, pointerdown, keydown).
   * - `duration` ms (plus a small safety buffer) elapse.
   * - A new `anchorScroll` call starts.
   * - The hosting component unmounts.
   */
  anchorScroll: (anchor: HTMLElement | null, duration: number) => void;
};

/**
 * Keeps an anchor element visually fixed in the viewport while a nearby
 * container element changes size.
 *
 * Useful around expand/collapse, accordion, and tab-switch transitions
 * where the natural document flow would otherwise push focused content out
 * of (or into) the viewport. Uses a `ResizeObserver` on the container to
 * react to layout changes without polling, and `scrollBy` to nudge either
 * the page or an opt-in scroll container so the anchor's
 * `getBoundingClientRect().top` stays constant.
 */
export function useScrollAnchor<
  TContainer extends HTMLElement = HTMLElement,
  TScroll extends HTMLElement = HTMLElement,
>(): UseScrollAnchorResult<TContainer, TScroll> {
  const containerRef = React.useRef<TContainer | null>(null);
  const scrollContainerRef = React.useRef<TScroll | null>(null);
  // Tracks the cleanup for the currently in-flight anchoring session so a
  // new call (or unmount) can abort it cleanly instead of leaving a
  // ResizeObserver and listeners holding references to detached nodes.
  const activeSessionCleanupRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    return () => {
      activeSessionCleanupRef.current?.();
      activeSessionCleanupRef.current = null;
    };
  }, []);

  const anchorScroll = React.useCallback((anchor: HTMLElement | null, duration: number) => {
    const container = containerRef.current;
    if (!container || !anchor) {
      return;
    }

    // Abort any in-flight session before starting a new one; otherwise the
    // previous ResizeObserver and listeners would race with this one.
    activeSessionCleanupRef.current?.();
    activeSessionCleanupRef.current = null;

    // Snapshot the scroll target at session start so a later ref change
    // doesn't redirect compensation mid-flight. `scrollElement` is the attached
    // container (if any); `scrollTarget` is what receives the user-interaction
    // listeners (the container or the window).
    const scrollElement: HTMLElement | null = scrollContainerRef.current;
    const scrollTarget: HTMLElement | Window = scrollElement ?? window;
    const interactionTarget: EventTarget = scrollTarget;

    // Mutable so it can be re-baselined when an attached container can't yet
    // absorb a delta (see below).
    let initialTop = anchor.getBoundingClientRect().top;
    let active = true;
    let cleanupTimer: ReturnType<typeof setTimeout>;

    // ResizeObserver compensates only when the container layout actually
    // changes, rather than polling every animation frame. Callbacks fire
    // after layout, so getBoundingClientRect() reads already-computed
    // values without forcing an extra reflow.
    const observer = new ResizeObserver(() => {
      if (!active) {
        return;
      }
      const delta = anchor.getBoundingClientRect().top - initialTop;
      if (Math.abs(delta) <= 0.5) {
        return;
      }
      if (!scrollElement) {
        window.scrollBy(0, delta);
        return;
      }
      const before = scrollElement.scrollTop;
      scrollElement.scrollBy(0, delta);
      const remainder = delta - (scrollElement.scrollTop - before);
      if (Math.abs(remainder) > 0.5) {
        // The container couldn't absorb this part — it isn't scrollable yet
        // (its content hasn't exceeded its `max-height`). Re-baseline instead
        // of forcing the difference elsewhere: scrolling the page would shift
        // the surrounding layout, and carrying the delta forward would snap the
        // anchor back the instant the container becomes scrollable. Accepting
        // the small drift now keeps the surrounding layout still and lets the
        // container hold the anchor smoothly from here on.
        initialTop += remainder;
      }
    });

    function cleanup() {
      if (!active) {
        return;
      }
      active = false;
      clearTimeout(cleanupTimer);
      observer.disconnect();
      interactionTarget.removeEventListener('wheel', stopOnUserInteraction);
      interactionTarget.removeEventListener('touchmove', stopOnUserInteraction);
      interactionTarget.removeEventListener('pointerdown', stopOnUserInteraction);
      interactionTarget.removeEventListener('keydown', stopOnUserInteraction);
      if (activeSessionCleanupRef.current === cleanup) {
        activeSessionCleanupRef.current = null;
      }
    }
    activeSessionCleanupRef.current = cleanup;

    // Stop compensating if the user interacts (scroll, click, keyboard),
    // since UI changes like tab switches can invalidate anchor measurements.
    function stopOnUserInteraction() {
      cleanup();
    }
    interactionTarget.addEventListener('wheel', stopOnUserInteraction, {
      passive: true,
      once: true,
    });
    interactionTarget.addEventListener('touchmove', stopOnUserInteraction, {
      passive: true,
      once: true,
    });
    interactionTarget.addEventListener('pointerdown', stopOnUserInteraction, {
      passive: true,
      once: true,
    });
    interactionTarget.addEventListener('keydown', stopOnUserInteraction, {
      passive: true,
      once: true,
    });

    observer.observe(container);

    // Safety cleanup after the layout transition completes.
    cleanupTimer = setTimeout(cleanup, duration + 500);
  }, []);

  return { containerRef, scrollContainerRef, anchorScroll };
}
