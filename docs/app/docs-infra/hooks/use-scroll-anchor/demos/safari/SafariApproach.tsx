'use client';
import * as React from 'react';
import { Chat } from './Chat';
import { useStreamedHistory } from './useStreamedHistory';
import styles from './Safari.module.css';

// "Safari behaviour" — Safari does not implement CSS scroll anchoring
// (WebKit bug 171099). When older messages stream in above the visible
// area, the scroll position stays where it is in the document and each
// new message visibly shoves the conversation down.
export function SafariApproach() {
  // @focus-start @padding 1
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const { messages, streaming, start, reset } = useStreamedHistory();

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, []);

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
      <Chat scrollerRef={scrollerRef} messages={messages} />
    </React.Fragment>
  );
  // @focus-end
}
