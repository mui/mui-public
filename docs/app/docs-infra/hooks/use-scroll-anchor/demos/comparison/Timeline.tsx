'use client';
import * as React from 'react';
import { olderEvents, visibleEvents } from './events';
import styles from './Comparison.module.css';

export const ANIMATION_DURATION = 600;

type TimelineProps = {
  containerRef?: React.Ref<HTMLDivElement>;
  showOlder: boolean;
  animate: boolean;
  onToggle: () => void;
  registerVisibleItem?: (id: string, node: HTMLLIElement | null) => void;
};

export function Timeline({
  containerRef,
  showOlder,
  animate,
  onToggle,
  registerVisibleItem,
}: TimelineProps) {
  return (
    <div ref={containerRef} className={styles.timeline}>
      {/* @focus-start */}
      <div className={styles.expandRow}>
        <button type="button" onClick={onToggle} className={styles.expandButton}>
          {showOlder ? 'Hide earlier events' : 'Load earlier events'}
        </button>
      </div>

      <div
        className={styles.older}
        data-open={showOlder ? '' : undefined}
        data-animate={animate ? '' : undefined}
        style={{ ['--anim-duration' as string]: `${ANIMATION_DURATION}ms` }}
      >
        <ol className={styles.olderInner}>
          {olderEvents.map((event) => (
            <li key={event.id} className={styles.event}>
              <time className={styles.time}>{event.time}</time>
              <div className={styles.eventBody}>
                <h4 className={styles.eventTitle}>{event.title}</h4>
                <p className={styles.eventDescription}>{event.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.divider} aria-hidden="true">
        <span>Currently viewing</span>
      </div>

      <ol className={styles.list}>
        {visibleEvents.map((event) => (
          <li
            key={event.id}
            ref={(node) => {
              registerVisibleItem?.(event.id, node);
            }}
            className={styles.event}
          >
            <time className={styles.time}>{event.time}</time>
            <div className={styles.eventBody}>
              <h4 className={styles.eventTitle}>{event.title}</h4>
              <p className={styles.eventDescription}>{event.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {/* @focus-end */}
    </div>
  );
}
