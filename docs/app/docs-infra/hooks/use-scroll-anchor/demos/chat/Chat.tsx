'use client';
import * as React from 'react';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import styles from './Chat.module.css';

type Message = {
  id: string;
  author: string;
  avatar: string;
  time: string;
  body: string;
};

// Pages of older messages, served oldest-page-first so the most recent
// page lands closest to the divider when prepended.
const olderPages: Message[][] = [
  [
    {
      id: 'p3-1',
      author: 'Priya',
      avatar: 'P',
      time: '09:02',
      body: 'Morning! Pushing the migration script for review in a sec.',
    },
    {
      id: 'p3-2',
      author: 'Marco',
      avatar: 'M',
      time: '09:05',
      body: "Nice. I'll spin up a staging DB so we can dry-run it.",
    },
    {
      id: 'p3-3',
      author: 'Priya',
      avatar: 'P',
      time: '09:11',
      body: 'PR is up: #4821. Tests are green.',
    },
  ],
  [
    {
      id: 'p2-1',
      author: 'Sam',
      avatar: 'S',
      time: '09:18',
      body: 'Reviewed - left two comments about the rollback path.',
    },
    {
      id: 'p2-2',
      author: 'Priya',
      avatar: 'P',
      time: '09:24',
      body: 'Good catch on the FK constraint. Pushing a fix.',
    },
    {
      id: 'p2-3',
      author: 'Marco',
      avatar: 'M',
      time: '09:27',
      body: 'Staging dry-run took 42s. No errors.',
    },
  ],
  [
    {
      id: 'p1-1',
      author: 'Sam',
      avatar: 'S',
      time: '09:33',
      body: 'Re-reviewed. Looks good to me.',
    },
    {
      id: 'p1-2',
      author: 'Priya',
      avatar: 'P',
      time: '09:35',
      body: 'Merging now. Will kick off the prod migration after lunch.',
    },
  ],
];

const recentMessages: Message[] = [
  {
    id: 'r1',
    author: 'Priya',
    avatar: 'P',
    time: '12:48',
    body: 'Migration is running on prod. ETA about 3 minutes.',
  },
  {
    id: 'r2',
    author: 'Marco',
    avatar: 'M',
    time: '12:51',
    body: 'Watching the dashboard. p99 looks normal.',
  },
  {
    id: 'r3',
    author: 'Sam',
    avatar: 'S',
    time: '12:53',
    body: 'Done. Schema version bumped to 47.',
  },
];

export function Chat() {
  // @focus-start @padding 1
  const [loadedPages, setLoadedPages] = React.useState(0);
  const [freshIds, setFreshIds] = React.useState<ReadonlySet<string>>(() => new Set());
  // The thread scrolls inside its own overflow region, so attach
  // `scrollContainerRef` to that scrollable element. The hook will
  // compensate that container's scroll instead of the page.
  const { containerRef, scrollContainerRef, anchorScroll } = useScrollAnchor<
    HTMLDivElement,
    HTMLDivElement
  >();
  // Track the rendered messages so we can anchor on the topmost one in
  // the viewport - that's the message the user is reading right now.
  const messageRefs = React.useRef(new Map<string, HTMLLIElement | null>());

  const loadOlder = () => {
    // Pick the topmost message currently inside the scroll container.
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    const viewportRect = scrollContainer.getBoundingClientRect();
    let topVisible: HTMLLIElement | null = null;
    let topVisibleY = Infinity;
    messageRefs.current.forEach((node) => {
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (
        rect.bottom > viewportRect.top &&
        rect.top < viewportRect.bottom &&
        rect.top < topVisibleY
      ) {
        topVisible = node;
        topVisibleY = rect.top;
      }
    });
    anchorScroll(topVisible, 350);
    setLoadedPages((prev) => {
      const next = Math.min(prev + 1, olderPages.length);
      if (next > prev) {
        const newPage = olderPages[olderPages.length - next];
        setFreshIds(new Set(newPage.map((message) => message.id)));
      }
      return next;
    });
  };
  // @focus-end

  const visiblePages = olderPages.slice(olderPages.length - loadedPages);
  const allMessages = [...visiblePages.flat(), ...recentMessages];
  const hasMore = loadedPages < olderPages.length;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.channel}># release-room</span>
        <span className={styles.subtitle}>Migration coordination</span>
        {loadedPages > 0 ? (
          <button
            type="button"
            className={styles.resetButton}
            onClick={() => {
              setLoadedPages(0);
              setFreshIds(new Set());
            }}
          >
            Reset
          </button>
        ) : null}
      </header>

      <div ref={scrollContainerRef} className={styles.scroller}>
        <div ref={containerRef} className={styles.thread}>
          <div className={styles.loadRow}>
            {hasMore ? (
              <button type="button" onClick={loadOlder} className={styles.loadButton}>
                Load earlier messages
              </button>
            ) : (
              <span className={styles.threadStart}>Beginning of conversation</span>
            )}
          </div>

          <ol className={styles.list}>
            {allMessages.map((message) => (
              <li
                key={message.id}
                ref={(node) => {
                  messageRefs.current.set(message.id, node);
                }}
                className={styles.message}
                data-fresh={freshIds.has(message.id) ? '' : undefined}
              >
                <div className={styles.avatar} aria-hidden="true">
                  {message.avatar}
                </div>
                <div className={styles.body}>
                  <div className={styles.meta}>
                    <span className={styles.author}>{message.author}</span>
                    <time className={styles.time}>{message.time}</time>
                  </div>
                  <p className={styles.text}>{message.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
