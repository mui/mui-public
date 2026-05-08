'use client';
import * as React from 'react';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { Chat } from './Chat';
import { useStreamedHistory } from './useStreamedHistory';
import styles from './Safari.module.css';

// "useScrollAnchor hook" — works the same way on every browser, including
// Safari. Just before each new message is prepended we call `anchorScroll`
// with the topmost message currently in the viewport. The hook detects
// the resulting layout shift on the list and adjusts the scroller's
// `scrollTop` so the anchor's visual position is preserved.
export function HookApproach() {
  // @focus-start @padding 1
  // containerRef → the inner <ol> that grows when we prepend.
  // scrollContainerRef → the outer scroller we want to compensate.
  const { containerRef, scrollContainerRef, anchorScroll } = useScrollAnchor<
    HTMLOListElement,
    HTMLDivElement
  >();
  const messageRefs = React.useRef(new Map<string, HTMLLIElement | null>());

  const pinTopVisible = React.useCallback(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) {
      return;
    }
    const scrollerTop = scroller.getBoundingClientRect().top;
    let topVisible: HTMLLIElement | null = null;
    let topVisibleY = Infinity;
    messageRefs.current.forEach((node) => {
      if (!node) {
        return;
      }
      const top = node.getBoundingClientRect().top;
      if (top >= scrollerTop && top < topVisibleY) {
        topVisible = node;
        topVisibleY = top;
      }
    });
    anchorScroll(topVisible, 0);
  }, [anchorScroll, scrollContainerRef]);

  const { messages, streaming, start, reset } = useStreamedHistory({
    onBeforePrepend: pinTopVisible,
  });
  // @focus-end

  React.useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [scrollContainerRef]);

  return (
    <React.Fragment>
      <div className={styles.actions}>
        <button type="button" onClick={start} disabled={streaming} className={styles.actionButton}>
          {streaming ? 'Streaming…' : 'Stream older messages'}
        </button>
        <button type="button" onClick={reset} className={styles.actionButtonGhost}>
          Reset
        </button>
      </div>
      <Chat
        scrollerRef={scrollContainerRef}
        listRef={containerRef}
        messages={messages}
        registerMessage={(id, node) => {
          messageRefs.current.set(id, node);
        }}
      />
    </React.Fragment>
  );
}
