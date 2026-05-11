'use client';
import * as React from 'react';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { ANIMATION_DURATION, Timeline } from './Timeline';

// "useScrollAnchor hook" — pin an explicit anchor element you choose, even
// while the layout above is animating. Works in every browser including
// Safari and survives animated reflows.
export function HookApproach({ animate }: { animate: boolean }) {
  // @focus-start @padding 1
  const [showOlder, setShowOlder] = React.useState(false);
  const { containerRef, anchorScroll } = useScrollAnchor<HTMLDivElement>();
  // Track the "currently viewing" rows so we can pick one as an anchor.
  // Only these rows are valid anchors: the older rows live inside the
  // region that grows or shrinks, so they aren't stable references.
  const visibleRefs = React.useRef(new Map<string, HTMLLIElement | null>());

  const toggleOlder = () => {
    // Pick the topmost "currently viewing" row in the viewport — that's
    // what the reader's eye is closest to, and it stays in the layout
    // regardless of whether we're expanding or collapsing.
    let topVisible: HTMLLIElement | null = null;
    let topVisibleY = Infinity;
    visibleRefs.current.forEach((node) => {
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight && rect.top < topVisibleY) {
        topVisible = node;
        topVisibleY = rect.top;
      }
    });
    anchorScroll(topVisible, animate ? ANIMATION_DURATION : 350);
    setShowOlder((prev) => !prev);
  };
  // @focus-end

  return (
    <Timeline
      containerRef={containerRef}
      showOlder={showOlder}
      animate={animate}
      onToggle={toggleOlder}
      registerVisibleItem={(id, node) => {
        visibleRefs.current.set(id, node);
      }}
    />
  );
}
