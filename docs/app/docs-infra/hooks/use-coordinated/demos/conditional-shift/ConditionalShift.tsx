'use client';
import * as React from 'react';
import { useCoordinated } from '@mui/internal-docs-infra/useCoordinated';
import styles from './ConditionalShift.module.css';

type Pref = 'brief' | 'normal' | 'verbose';
const PREFS: Pref[] = ['brief', 'normal', 'verbose'];

type SectionName = 'Network' | 'Storage' | 'Battery';

// The whole point of the demo: the body length per preference is
// very different, so an *open* section visibly resizes when the
// preference flips. A *closed* section's header height never
// changes, so it can flip without waiting.
const BODIES: Record<SectionName, Record<Pref, string>> = {
  Network: {
    brief: 'OK.',
    normal: 'Connected via Wi-Fi. 45 ms round trip to the gateway.',
    verbose:
      'Connected via Wi-Fi on 5 GHz channel 36. Round trip to gateway 45 ms; ' +
      'to 1.1.1.1 18 ms. IPv6 active. Last reconnection 3 h 12 m ago. ' +
      'Packet loss in the last 5 minutes: 0.',
  },
  Storage: {
    brief: '64% used.',
    normal: '320 GB used of 500 GB. About 180 GB free.',
    verbose:
      '320 GB used of 500 GB (64%). Largest categories: Photos 142 GB, ' +
      'System 38 GB, Applications 26 GB. Trash holds 4.1 GB that can be ' +
      'reclaimed. Last snapshot taken 12 minutes ago.',
  },
  Battery: {
    brief: '78%.',
    normal: 'At 78%, discharging. About 4h 20m remaining.',
    verbose:
      'At 78%, currently discharging at 6.4 W. About 4h 20m remaining at ' +
      'this rate. Cycle count 312 of an expected 1000. Design capacity ' +
      'retained: 94%. Charger last connected 1h 04m ago.',
  },
};

// Different per-section "preload" latencies make the barrier
// coordination visible when more than one section is open.
const PRELOAD_MS: Record<SectionName, number> = {
  Network: 600,
  Storage: 250,
  Battery: 80,
};

// Artificial delay for lazy peers to visually demonstrate that they wait
// for the barrier to commit before applying their updates. In production,
// this delay would be ~0ms (just one macrotask hop via setTimeout(0)).
// Here we exaggerate it to 800ms so the demo clearly shows the deferral.
const LAZY_DEFERRAL_DISPLAY_MS = 800;

function Section({
  name,
  pref,
  onChangePref,
}: {
  name: SectionName;
  pref: Pref;
  onChangePref: (next: Pref) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Track the delayed update for lazy peers to visually demonstrate deferral
  const [delayedCommitId, setDelayedCommitId] = React.useState<NodeJS.Timeout | null>(null);
  // `causesLayoutShift` / `preload` are captured by the engine when
  // an announcement is made. Reading the latest open-state out of a
  // ref keeps the routing decision fresh without churning the
  // callbacks (which would restart in-flight barriers).
  const openRef = React.useRef(open);
  // eslint-disable-next-line react-hooks/refs
  openRef.current = open;

  const tuple = React.useMemo<[Pref, (next: Pref) => void]>(
    () => [pref, onChangePref],
    [pref, onChangePref],
  );

  // @focus-start @padding 1
  const [visiblePref, , extras] = useCoordinated<Pref, void>(tuple, {
    channelKey: 'conditional-shift-demo',
    peerId: `section-${name}`,
    // The same announcement is routed differently per peer, based
    // on whether THIS section is currently expanded:
    //   - open  → barrier path: wait for sibling open sections to
    //             finish their preloads, then flip together.
    //   - closed → lazy path: commit immediately; never block the
    //             barrier the open sections are running.
    causesLayoutShift: () => openRef.current,
    // Loading affordance overlaps with the simulated preload window,
    // so the section's `data-pending` highlight is visible the moment
    // the user clicks rather than appearing after preload settles.
    animateDuringPreload: true,
    // The simulated preload is I/O-shaped (a timer standing in for a
    // fetch). Skip the idle commit so closed (lazy) sections flip as
    // soon as their own delay elapses, instead of waiting for a
    // browser-scheduled idle slot.
    lazyCommitPriority: 'normal',
    // Simulated work that only matters when we're going to repaint
    // the body. Closed peers skip waiting and resolve immediately.
    preload: (_target, signal) =>
      new Promise<void>((resolve, reject) => {
        if (!openRef.current) {
          // For lazy peers, add an artificial display delay to visually
          // demonstrate that they wait until after the barrier commits.
          // In production, this would be ~0ms (one macrotask via setTimeout).
          const id = setTimeout(resolve, LAZY_DEFERRAL_DISPLAY_MS);
          setDelayedCommitId(id);
          signal.addEventListener('abort', () => {
            clearTimeout(id);
            setDelayedCommitId(null);
            reject(new Error('aborted'));
          });
          return;
        }
        const id = setTimeout(resolve, PRELOAD_MS[name]);
        signal.addEventListener('abort', () => {
          clearTimeout(id);
          reject(new Error('aborted'));
        });
      }),
    gracePeriodMs: 500,
  });
  // @focus-end

  React.useEffect(() => {
    // Cleanup any pending delayed commit if component unmounts
    return () => {
      if (delayedCommitId !== null) {
        clearTimeout(delayedCommitId);
      }
    };
  }, [delayedCommitId]);

  // The badge plus the one-line preview are always visible — even
  // when the section is collapsed. That's the cue: if you flip the
  // preference while this section is closed, both update *now*
  // (single-line text changes, no reflow); if it's open, they hold
  // with the rest of the open sections until they all flip together.
  const badge = (
    <span
      className={styles.badge}
      data-pending={extras.isCoordinating || undefined}
      title={
        extras.pendingValue !== visiblePref
          ? `pending: ${extras.pendingValue}`
          : `current: ${visiblePref}`
      }
    >
      {visiblePref}
    </span>
  );

  return (
    <div className={styles.section} data-open={open || undefined}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.chev} aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.sectionName}>{name}</span>
        {badge}
        {extras.isCoordinating ? (
          <span className={styles.spinner} aria-live="polite">
            {extras.isWaitingForPeers ? 'waiting…' : 'loading…'}
          </span>
        ) : null}
        <span className={styles.routeHint}>
          {open ? 'barrier (waits for other open sections)' : 'lazy (no barrier)'}
        </span>
      </button>
      {open ? (
        <p className={styles.body}>{BODIES[name][visiblePref]}</p>
      ) : (
        <p className={styles.preview} title={BODIES[name][visiblePref]}>
          {BODIES[name][visiblePref]}
        </p>
      )}
    </div>
  );
}

export function ConditionalShift() {
  // One shared preference. Every section subscribes via
  // `useCoordinated`, but each one decides per-announcement whether
  // the change reshapes its layout — based on whether it's open.
  const [pref, setPref] = React.useState<Pref>('brief');

  return (
    <div className={styles.container}>
      <p className={styles.intro}>
        <strong>Try this:</strong> first switch the preference with all sections closed. Every
        section is on the lazy path — its one-line preview updates immediately and never reflows.
        Then expand <em>Network</em> and <em>Storage</em>, leave <em>Battery</em> closed, and switch
        again: the two open sections wait for each other and flip together, while the closed Battery
        section&apos;s update is deferred (shown here with an exaggerated 800ms delay to demonstrate
        that lazy peers wait for the barrier to finish painting before they update). In a real app,
        this deferral would be just one macrotask, keeping the main thread clear for layout work.
      </p>
      <div className={styles.toolbar}>
        <span className={styles.label}>Detail:</span>
        {PREFS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPref(option)}
            className={
              pref === option ? `${styles.toggle} ${styles.toggleSelected}` : styles.toggle
            }
          >
            {option}
          </button>
        ))}
      </div>
      <div className={styles.list}>
        {(['Network', 'Storage', 'Battery'] as SectionName[]).map((name) => (
          <Section key={name} name={name} pref={pref} onChangePref={setPref} />
        ))}
      </div>
    </div>
  );
}
