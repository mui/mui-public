'use client';
import * as React from 'react';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import styles from './Comparison.module.css';

const ANIMATION_DURATION = 600;

type TimelineEvent = {
  id: string;
  time: string;
  title: string;
  body: string;
};

const olderEvents: TimelineEvent[] = [
  {
    id: 'e1',
    time: '08:14',
    title: 'Build started',
    body: 'CI picked up commit a1b2c3d on the release branch.',
  },
  {
    id: 'e2',
    time: '08:21',
    title: 'Tests queued',
    body: 'Sharding 1,284 specs across 8 runners.',
  },
  {
    id: 'e3',
    time: '08:34',
    title: 'Lint passed',
    body: 'No new warnings introduced; 0 errors across 482 files.',
  },
  {
    id: 'e4',
    time: '08:41',
    title: 'Unit tests passed',
    body: '1,284 specs, 0 failures, 17 skipped.',
  },
  {
    id: 'e5',
    time: '08:55',
    title: 'Bundle uploaded',
    body: 'Artifact pushed to staging at s3://artifacts/release/2.4.0.tar.gz.',
  },
  {
    id: 'e6',
    time: '09:02',
    title: 'Smoke tests started',
    body: 'Spawning 12 browsers across 3 regions.',
  },
];

const visibleEvents: TimelineEvent[] = [
  {
    id: 'now1',
    time: '09:14',
    title: 'Smoke tests passed',
    body: 'All regions green. Ready for canary rollout.',
  },
  {
    id: 'now2',
    time: '09:18',
    title: 'Canary deployed',
    body: '5% of traffic routed to release-2.4.0. Monitoring error budget.',
  },
  {
    id: 'now3',
    time: '09:31',
    title: 'Rollout complete',
    body: '100% of traffic on release-2.4.0. No regression detected over 13m window.',
  },
];

type Mode = 'none' | 'browser' | 'hook';

const modeLabels: Record<Mode, string> = {
  none: 'No anchoring',
  browser: 'Browser scroll anchoring',
  hook: 'useScrollAnchor hook',
};

const modeDescriptions: Record<Mode, string> = {
  none: 'overflow-anchor: none — what every Safari user sees by default.',
  browser:
    'overflow-anchor: auto — Chromium and Firefox compensate for instant layout changes above the topmost visible element.',
  hook: 'useScrollAnchor — pins an explicit anchor element you choose, even mid-animation.',
};

export function Comparison() {
  // @focus-start @padding 1
  const [mode, setMode] = React.useState<Mode>('hook');
  const [animate, setAnimate] = React.useState(true);
  const [showOlder, setShowOlder] = React.useState(false);
  const { containerRef, anchorScroll } = useScrollAnchor<HTMLDivElement>();
  // Track the "currently viewing" rows so we can pick one as an anchor.
  // Only these rows are valid anchors: the older rows live inside the
  // region that grows or shrinks, so they aren't stable references.
  const visibleRefs = React.useRef(new Map<string, HTMLLIElement | null>());

  const toggleOlder = () => {
    if (mode === 'hook') {
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
    }
    setShowOlder((prev) => !prev);
  };
  // @focus-end

  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.controls}>
        <fieldset className={styles.modePicker}>
          <legend className={styles.modeLegend}>Anchoring strategy</legend>
          {(Object.keys(modeLabels) as Mode[]).map((value) => (
            <label key={value} className={styles.modeOption} data-active={value === mode}>
              <input
                type="radio"
                name="anchor-mode"
                value={value}
                checked={value === mode}
                onChange={() => setMode(value)}
              />
              <span>{modeLabels[value]}</span>
            </label>
          ))}
        </fieldset>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={animate}
            onChange={(event) => setAnimate(event.target.checked)}
          />
          <span>Animate</span>
        </label>
      </div>

      <p className={styles.hint}>{modeDescriptions[mode]}</p>

      <div ref={containerRef} className={styles.timeline}>
        <div className={styles.expandRow}>
          <button type="button" onClick={toggleOlder} className={styles.expandButton}>
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
                visibleRefs.current.set(event.id, node);
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
      </div>
    </div>
  );
}
